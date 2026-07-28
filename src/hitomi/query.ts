/**
 * Hitomi's search query language, ported from the site's own `results.js` `do_search()` and
 * `search.js` (`get_galleryids_for_query`, `nozomi_address_from_state`).
 *
 * A query is set algebra over `.nozomi` id indexes:
 *   `female:yuri -female:futanari type:manga`   → intersect, then subtract
 *   `female:yuri or female:yaoi`                → OR group, retained against the running set
 *   `orderby:popular orderbykey:week`           → sort directives, folded into the nozomi path
 * Spaces inside a term are written `_` (the site's convention), so the whole query stays
 * whitespace-tokenizable: `female:big_breasts`.
 *
 * This module is pure — parsing and URL construction only. The fetching/intersection engine lives
 * in `hitomi.ts`, which needs the bridge's `request`.
 */

/** Which nozomi ordering to read. Mirrors the site's `state.orderby` / `orderbykey`. */
export interface SortState {
  orderby: "date" | "popular";
  /** `added` | `published` for date; `today` | `week` | `month` | `year` for popular. */
  orderbykey: string;
  direction: "desc" | "asc" | "random";
}

/** One search atom. `ns: ""` means free text (resolved through the galleries full-text index). */
export interface Term {
  ns: string;
  value: string;
}

export interface ParsedQuery {
  positive: Term[];
  negative: Term[];
  /** Each group is an OR set: a result must match at least one member of every group. */
  orGroups: Term[][];
  sort: SortState;
  /**
   * Folded into *every* nozomi path as a whole extra dimension (`tag/female:yuri-japanese.nozomi`),
   * rather than intersected as a term. The site intersects with the full `index-{lang}` index; this
   * is the same result for far fewer bytes, and matches what the site's own language dropdown does.
   */
  language: string;
}

/** Nozomi namespaces that are also visible on a `galleryblock` card, so a term in one of them can be
 * evaluated late (per-card) instead of downloading its whole index. `character` and `group` are
 * deliberately absent — the card doesn't carry them. */
export const CARD_VISIBLE_NS: ReadonlySet<string> = new Set([
  "tag",
  "female",
  "male",
  "artist",
  "series",
  "type",
  "language",
]);

/** Namespaces that map to a real nozomi area. Anything else is treated as free text. */
const KNOWN_NS: ReadonlySet<string> = new Set([
  "tag",
  "female",
  "male",
  "artist",
  "group",
  "series",
  "character",
  "type",
  "language",
]);

export const DEFAULT_SORT: SortState = { orderby: "date", orderbykey: "added", direction: "desc" };

/** `results.js`: `sortby:`/`orderby:`/`orderbykey:`/`orderbydirection:`. */
const DIRECTIVE = /^(?:sort|order)by(?:key|direction)?:/;

function applyDirective(token: string, sort: SortState): void {
  const colon = token.indexOf(":");
  const left = token.slice(0, colon);
  const right = token.slice(colon + 1);

  if (/^(?:sort|order)(?:by)?key$/.test(left)) {
    sort.orderbykey = right.replace(/[^0-9a-z]/g, "");
    return;
  }
  if (left === "orderbydirection" || left === "sortbydirection") {
    const d = right.replace(/[^0-9a-z]/g, "");
    if (d === "asc" || d === "ascending") sort.direction = "asc";
    else if (d === "rand" || d === "random") sort.direction = "random";
    else sort.direction = "desc";
    return;
  }
  // orderby: / sortby:
  if (right === "popular" || right === "popularity") sort.orderby = "popular";
  else if (right === "date") sort.orderby = "date";
  else if (right === "datepublished") {
    sort.orderby = "date";
    sort.orderbykey = "published";
  } else if (right === "random" || right === "rand") sort.direction = "random";
}

/** Split a token into a term. `female:yuri` → ns female; a bare word → free text. */
function toTerm(token: string): Term {
  const colon = token.indexOf(":");
  if (colon > 0) {
    const ns = token.slice(0, colon);
    const value = token.slice(colon + 1).trim();
    if (KNOWN_NS.has(ns) && value) return { ns, value };
  }
  return { ns: "", value: token.trim() };
}

/**
 * A whole-query `namespace/value` selector, as emitted by older `tagQueries` (and by the site's own
 * tag urls). Handled before tokenizing because the value may contain spaces
 * (`tag/female:big breasts`), which whitespace-splitting would destroy.
 */
function selectorTerm(raw: string): Term | undefined {
  const m = /^([a-z]+)\/(.+)$/.exec(raw);
  if (!m) return undefined;
  const [, ns, rest] = m as unknown as [string, string, string];
  // `tag/female:big breasts` — the sub-namespace wins, matching the site's own url shape.
  const sub = /^(female|male):(.+)$/.exec(rest);
  if (ns === "tag" && sub) return { ns: sub[1]!, value: sub[2]!.trim() };
  if (!KNOWN_NS.has(ns)) return undefined;
  return { ns, value: rest.trim() };
}

/**
 * Parse a raw query into terms + sort state, following `do_search()` (`results.js:10-95`):
 * `or`-joined tokens form OR groups, `-` marks a negation, and namespaced positives sort ahead of
 * free-text ones (the site picks the first positive as its base set, and a namespaced index is far
 * cheaper to fetch than a full-text lookup).
 */
export function parseQuery(raw: string, language = "all"): ParsedQuery {
  const sort: SortState = { ...DEFAULT_SORT };
  let orderbykeyGiven = false;
  const positive: Term[] = [];
  const negative: Term[] = [];
  let orGroups: Term[][] = [[]];

  const trimmed = raw.trim();
  const selector = selectorTerm(trimmed);
  if (selector) {
    positive.push(selector);
  } else {
    const tokens = trimmed
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    tokens.forEach((rawToken, i) => {
      const token = rawToken.replace(/_/g, " ");

      if (DIRECTIVE.test(token)) {
        if (/^(?:sort|order)(?:by)?key:/.test(token)) orderbykeyGiven = true;
        applyDirective(token, sort);
        return;
      }
      if (token === "or") return;

      // `a or b` — both sides join the group currently being built.
      const orPrev = i > 0 && tokens[i - 1] === "or";
      const orNext = i + 1 < tokens.length && tokens[i + 1] === "or";
      if (orPrev || orNext) {
        orGroups[orGroups.length - 1]!.push(toTerm(token));
        if (!orNext) orGroups.push([]);
        return;
      }

      if (token.startsWith("-")) negative.push(toTerm(token.slice(1)));
      else positive.push(toTerm(token));
    });
  }

  orGroups = orGroups.filter((g) => g.length > 0);

  // The site defaults orderbykey from orderby when it wasn't given explicitly.
  if (!orderbykeyGiven && sort.orderby === "popular") sort.orderbykey = "year";

  // `language:x` is a dimension of every nozomi path, not a set to intersect — hoist it out.
  let lang = language;
  for (let i = positive.length - 1; i >= 0; i--) {
    if (positive[i]!.ns === "language") {
      lang = positive[i]!.value;
      positive.splice(i, 1);
    }
  }

  // Namespaced positives first: cheaper as a base set than a full-text lookup.
  positive.sort((a, b) => (a.ns ? 0 : 1) - (b.ns ? 0 : 1));

  return { positive, negative, orGroups, sort, language: lang };
}

/** The nozomi coordinates a term reads from (`get_galleryids_for_query`, `search.js:651-670`). */
export function termArea(term: Term): { area: string; tag: string } | undefined {
  if (!term.ns) return undefined; // free text — full-text index, not a nozomi
  // female/male live under the `tag` area, keyed with their prefix intact.
  if (term.ns === "female" || term.ns === "male") return { area: "tag", tag: `${term.ns}:${term.value}` };
  if (term.ns === "language") return { area: "all", tag: "index" };
  return { area: term.ns, tag: term.value };
}

/**
 * Build a nozomi url, porting `nozomi_address_from_state` (`search.js:612-624`). The four shapes and
 * their segment order are load-bearing — `popular/week/tag/…` 404s where `tag/popular/week/…` works.
 *
 * Uses the uncompressed paths (not the `/n/` gzip variants): only these can be byte-range paged,
 * since a Range into a gzip stream doesn't line up with the packed int32 ids.
 */
export function nozomiUrl(ltn: string, area: string, tag: string, language: string, sort: SortState): string {
  const key = encodeURIComponent(tag);
  if (sort.orderby !== "date" || sort.orderbykey === "published") {
    if (area === "all") return `${ltn}/${sort.orderby}/${sort.orderbykey}-${language}.nozomi`;
    return `${ltn}/${area}/${sort.orderby}/${sort.orderbykey}/${key}-${language}.nozomi`;
  }
  if (area === "all") return `${ltn}/${key}-${language}.nozomi`;
  return `${ltn}/${area}/${key}-${language}.nozomi`;
}

/** Stable identity for a resolved query, used to key the paging cursor cache. */
export function querySignature(q: ParsedQuery): string {
  const t = (term: Term) => `${term.ns}:${term.value}`;
  return [
    q.positive.map(t).sort().join(","),
    q.negative.map(t).sort().join(","),
    q.orGroups.map((g) => g.map(t).sort().join("|")).sort().join(";"),
    q.language,
    `${q.sort.orderby}/${q.sort.orderbykey}/${q.sort.direction}`,
  ].join("~");
}
