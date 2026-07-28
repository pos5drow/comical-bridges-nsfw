/**
 * Hitomi.la bridge — https://hitomi.la (doujinshi / artist CG galleries).
 *
 * Galleries have no chapter structure, so this uses the "direct" capability: `getSeriesPages`
 * returns a flat page list. There is no HTML listing on the site (it's a client-rendered SPA);
 * browse/search instead read the site's binary indexes, exactly as the site's own JS does.
 *
 * Data sources (all under ltn.gold-usergeneratedcontent.net unless noted):
 *  - `{area}/{tag}-{language}.nozomi` — packed big-endian int32 gallery-id lists, byte-range paged.
 *    Sort is folded into the path (`tag/popular/week/female:yuri-all.nozomi`), so ordering composes
 *    with a tag instead of replacing it.
 *  - `galleriesindex/galleries.{v}.{index,data}` — a B-tree over sha256-keyed terms, giving
 *    free-text (title/artist/series/…) search. See `ftsIds`.
 *  - `tagindex.hitomi.la/{ns}/{c}/{h}/…json` — tag autocomplete with usage counts (`getTags`).
 *  - `galleryblock/{id}.html` — a ~2 KB card fragment. It carries the gallery's *full* tag list,
 *    artists, series, type and language, which is what makes `exclude-tags` free here: redaction and
 *    late-stage query predicates read the card we were already going to fetch.
 *  - `galleries/{id}.js` — the full gallery info JSON (tags, files, related, languages).
 *  - `gg.js` — the rotating table that derives each page image's subdomain + path.
 *
 * Search is genuine set algebra over those indexes — see `resolve`/`collect` and `hitomi/query.ts`.
 *
 * Every image (covers and pages) is hotlink-protected — the CDN 404s without a
 * `Referer: https://hitomi.la/` — so all image URLs are served through the host's `/img-proxy`
 * (declared via `assetProxy`), which attaches that Referer server-side.
 */
import {
  BridgeBase,
  type BridgeInfo,
  type Filter,
  type ListOptions,
  type Page,
  type PagedResults,
  type RelatedSeriesGroup,
  type SearchOptions,
  type SeriesEntry,
  type SeriesInfo,
  type SeriesList,
  type SortOption,
  type Tag,
  type TagGroup,
  abbreviateLanguage,
  base64ToBytes,
  defineBridge,
  parseFilterIncludeExclude,
} from "@comical/sdk";
import { LANGUAGES } from "./hitomi/languages.ts";
import {
  CARD_VISIBLE_NS,
  DEFAULT_SORT,
  type ParsedQuery,
  type SortState,
  type Term,
  nozomiUrl,
  parseQuery,
  querySignature,
  termArea,
} from "./hitomi/query.ts";
import { sha256 } from "./hitomi/sha256.ts";

const SITE = "https://hitomi.la";
const D2 = "gold-usergeneratedcontent.net";
const LTN = `https://ltn.${D2}`;
const TN = `https://tn.${D2}`;
/** Tag autocomplete lives on its own host (the site fetches it cross-origin; no Referer needed). */
const TAGINDEX = "https://tagindex.hitomi.la";
const REFERER = `${SITE}/`;
const PER_PAGE = 24;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const REDACTED_TITLE = "Hidden";

// ── Query engine budgets ────────────────────────────────────────────────────────

/**
 * A non-base term above this many bytes isn't downloaded; if its namespace is visible on a
 * galleryblock it becomes a per-card predicate instead. Keeps a query like
 * `female:yuri type:doujinshi` from pulling `type/doujinshi-all.nozomi` (2.7 MB) when the card we
 * already fetch says the type outright. The *base* term is never downloaded at all — it's
 * byte-range paged — so the whole-index cases (`index-all.nozomi`, 19 MB) never materialize.
 */
const MAX_TERM_BYTES = 1_000_000;
/** Ids pulled per scan iteration when a query needs late filtering. */
const SCAN_CHUNK = 128;
/** Ceiling on galleryblock fetches spent filtering one page, so a very rare predicate can't run away. */
const MAX_CARDS_PER_PAGE = 300;
const CURSOR_TTL_MS = 5 * 60 * 1000;
const INDEX_VERSION_TTL_MS = 5 * 60 * 1000;
const CARD_CACHE_MAX = 600;

// ── Full-text index layout (searchlib.js) ───────────────────────────────────────

const FTS_NODE_SIZE = 464;
const FTS_B = 16;

// ── gg.js (image path table) ────────────────────────────────────────────────────

/** Parsed gg.js: `b` base dir, plus the set of `g` cases that map to subdomain index 1 (else 0). */
interface Gg {
  b: string;
  cases: Set<number>;
}

// ── Gallery info DTOs (galleries/{id}.js) ───────────────────────────────────────

interface HitomiTag {
  tag?: string;
  male?: string;
  female?: string;
  url?: string;
}
interface HitomiNamed {
  url?: string;
  artist?: string;
  group?: string;
  parody?: string;
  character?: string;
}
interface HitomiFile {
  name: string;
  hash: string;
  haswebp?: number;
  hasavif?: number;
  width?: number;
  height?: number;
}
/**
 * A sibling gallery of the same work in another language. The site renders these into the navbar's
 * language dropdown rather than the page body (`gallery.js`), which is why they look absent — but
 * each is a separate gallery id, so they make a perfectly good related-series rail.
 */
interface HitomiLanguage {
  galleryid?: number | string;
  name?: string;
  language_localname?: string;
  url?: string;
}
interface GalleryInfo {
  id: string | number;
  title: string;
  japanese_title?: string | null;
  language?: string | null;
  language_localname?: string | null;
  type?: string;
  date?: string;
  datepublished?: string | null;
  related?: number[];
  languages?: HitomiLanguage[] | null;
  files: HitomiFile[];
  tags?: HitomiTag[];
  artists?: HitomiNamed[];
  groups?: HitomiNamed[] | null;
  parodys?: HitomiNamed[];
  characters?: HitomiNamed[];
}

// ── Static option lists ─────────────────────────────────────────────────────────

const TYPES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "doujinshi", label: "Doujinshi" },
  { value: "manga", label: "Manga" },
  { value: "artistcg", label: "Artist CG" },
  { value: "gamecg", label: "Game CG" },
  { value: "imageset", label: "Image Set" },
  { value: "anime", label: "Anime" },
];

const TYPE_LABELS: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

/** Sort keys, each a nozomi ordering. Unlike an "area", an ordering composes with any tag. */
const SORTS: ReadonlyArray<{ key: string; label: string; state: SortState }> = [
  { key: "latest", label: "Latest", state: { orderby: "date", orderbykey: "added", direction: "desc" } },
  { key: "published", label: "Date Published", state: { orderby: "date", orderbykey: "published", direction: "desc" } },
  { key: "popular-today", label: "Popular Today", state: { orderby: "popular", orderbykey: "today", direction: "desc" } },
  { key: "popular-week", label: "Popular This Week", state: { orderby: "popular", orderbykey: "week", direction: "desc" } },
  { key: "popular-month", label: "Popular This Month", state: { orderby: "popular", orderbykey: "month", direction: "desc" } },
  { key: "popular-year", label: "Popular This Year", state: { orderby: "popular", orderbykey: "year", direction: "desc" } },
  { key: "random", label: "Random", state: { orderby: "date", orderbykey: "added", direction: "random" } },
];

interface ListDef extends SeriesList {
  sort: string;
}

const LISTS: ReadonlyArray<ListDef> = [
  { id: "popular-today", name: "Popular Today", layout: "grid", featured: true, sort: "popular-today" },
  { id: "popular-week", name: "Popular This Week", layout: "grid", featured: true, sort: "popular-week" },
  { id: "latest", name: "Latest", layout: "grid", featured: true, sort: "latest" },
];

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** `real_full_path_from_hash`: "…a30" → "0/a3" (last char / previous two) — the tn thumbnail dir. */
function thumbDir(hash: string): string {
  return `${hash.slice(-1)}/${hash.slice(-3, -1)}`;
}

/**
 * Canonical tag id: `namespace:value`, lowercased. Deliberately the same vocabulary the search
 * query language uses, so `getTags` results, `tagQueries` chips and persisted `excludedTags` are all
 * directly runnable as search terms and directly comparable against a card's parsed facets.
 */
function tagId(ns: string, value: string): string {
  return `${ns}:${value}`.toLowerCase();
}

/** Human label for a `namespace:value` id, with the site's ♀/♂ markers. */
function tagLabel(id: string): string {
  const colon = id.indexOf(":");
  if (colon < 0) return id;
  const ns = id.slice(0, colon);
  const value = id.slice(colon + 1);
  if (ns === "female") return `${value} ♀`;
  if (ns === "male") return `${value} ♂`;
  if (ns === "tag") return value;
  return `${ns}: ${value}`;
}

/**
 * Map any hitomi taxonomy url to a tag id. Covers every link shape that appears on a galleryblock or
 * in gallery JSON: `/tag/female%3Abig%20breasts-all.html`, `/artist/shindol-all.html`,
 * `/type/manga-all.html`, `/index-english.html`.
 */
function tagIdFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const path = decodeURIComponent(url).replace(/^\//, "");
  const lang = /^index-([a-z]+)(?:-\d+)?\.html$/.exec(path);
  if (lang) return tagId("language", lang[1]!);
  const m = /^(tag|artist|series|character|group|type)\/(.+?)-[a-z]+(?:-\d+)?\.html$/.exec(path);
  if (!m) return undefined;
  const [, ns, value] = m as unknown as [string, string, string];
  if (ns === "tag") {
    const sub = /^(female|male):(.+)$/.exec(value);
    if (sub) return tagId(sub[1]!, sub[2]!);
  }
  return tagId(ns, value);
}

/**
 * A tag id as a search query token: the site writes spaces as `_` so a query stays
 * whitespace-tokenizable (`female:big_breasts`). Used for detail-page chips.
 */
function tagQuery(id: string): string {
  return id.replace(/ /g, "_");
}

/** Read a big-endian int32 array out of raw bytes — the nozomi and .data id encoding. */
function idsFromBytes(bytes: Uint8Array): number[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ids: number[] = [];
  for (let i = 0; i + 4 <= bytes.byteLength; i += 4) ids.push(view.getInt32(i, false));
  return ids;
}

/** 64-bit big-endian read without BigInt (not guaranteed in every on-device engine). */
function getU64(v: DataView, offset: number): number {
  return v.getUint32(offset, false) * 2 ** 32 + v.getUint32(offset + 4, false);
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 — a seeded PRNG, so `random` ordering is stable for a given query + page. */
function seededRandom(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) % 1_000_000) / 1_000_000;
}

// ── Engine types ────────────────────────────────────────────────────────────────

/** Where the scan pulls candidate ids from. A `nozomi` source is byte-range paged, never downloaded. */
type IdSource = { kind: "array"; ids: number[] } | { kind: "nozomi"; url: string; total: number };

interface Resolved {
  base: IdSource;
  /** Downloaded sets the result must be in. */
  intersect: Set<number>[];
  /** Downloaded sets the result must not be in. */
  subtract: Set<number>[];
  /** Card must carry at least one id from each clause (an OR group, or a demoted positive term). */
  lateInclude: string[][];
  /** Card must carry none of these ids. */
  lateExclude: string[];
  /** True when `base` alone is the answer — paging is then a single range request per page. */
  simple: boolean;
}

/** A parsed galleryblock: the display entry plus every taxonomy id the card exposes. */
interface Card {
  entry: SeriesEntry;
  facets: Set<string>;
}

// ── Bridge ──────────────────────────────────────────────────────────────────────

class HitomiBridge extends BridgeBase {
  readonly info: BridgeInfo = {
    id: "pos5drow.hitomi",
    name: "Hitomi.la",
    version: "0.2.0",
    contractVersion: "1.0.0",
    languages: ["multi"],
    nsfw: true,
    capabilities: [
      "lists",
      "search",
      "filters",
      "sort",
      "direct",
      "related-series",
      "exclude-tags",
      "resolve-tags",
    ],
    // Cards carry the artist line under the title.
    cardSubtitles: true,
    // hitomi.la/favicon.ico 404s; the real site icon is a CDN PNG (served without a Referer gate).
    iconUrl: `${LTN}/favicon-192x192.png`,
    // Static CDN — tolerates parallel card fetches; a browse page pulls ~24 galleryblocks.
    rateLimit: { maxConcurrent: 5, minIntervalMs: 120 },
    // Every image (covers + pages) is served through the host's /img-proxy with the required Referer.
    assetProxy: { hosts: [D2], referer: REFERER },
  };

  private gg: { at: number; value: Gg } | undefined;
  private ftsVersion: { at: number; value: string } | undefined;
  /** nozomi url → byte length (id count × 4). Cheap to obtain, worth not re-asking. */
  private readonly nozomiSizes = new Map<string, number>();
  /** query signature → scan progress, so sequential paging of a filtered query stays amortized O(1). */
  private readonly cursors = new Map<string, { at: number; ids: number[]; seen: Set<number>; scanned: number }>();
  private readonly cardCache = new Map<number, Card | null>();
  /** Last gallery JSON, so details + related + pages don't each refetch it. */
  private lastGallery: { id: string; value: GalleryInfo } | undefined;

  private headers(): Record<string, string> {
    return { "User-Agent": UA, Referer: REFERER };
  }

  // ── /img-proxy URL builder ─────────────────────────────────────────────────

  /**
   * Server-relative proxied URL. Every hitomi image (covers AND pages) is Referer-gated, so all of
   * them route through the host's `/img-proxy` (declared via `assetProxy`), which attaches the
   * `hitomi.la` Referer. A relative path (not an absolute host URL) lets each client resolve it
   * against its own host — the network server on web, the in-process transport on device — instead
   * of a host baked in here that a device can't reach.
   */
  private proxied(absUrl: string): string {
    return `/img-proxy?url=${encodeURIComponent(absUrl)}`;
  }

  private coverUrl(hash: string): string {
    return `${TN}/webpbigtn/${thumbDir(hash)}/${hash}.webp`;
  }

  /**
   * Per-page thumbnail (reader strip). Hitomi only renders the big `webpbigtn` thumbnail for a
   * gallery's cover image(s); interior pages 404 on `webpbigtn` and are only available as the
   * smaller `webpsmalltn` — so page thumbnails must use that, while covers keep `coverUrl`.
   */
  private pageThumbUrl(hash: string): string {
    return `${TN}/webpsmalltn/${thumbDir(hash)}/${hash}.webp`;
  }

  // ── gg.js ──────────────────────────────────────────────────────────────────

  /** Fetch + parse gg.js, cached briefly. `b` rotates (~hourly), so a short TTL keeps page URLs fresh. */
  private async getGg(): Promise<Gg> {
    const GG_TTL_MS = 3 * 60 * 1000;
    if (this.gg && Date.now() - this.gg.at < GG_TTL_MS) return this.gg.value;
    const text = await this.fetchText(`${LTN}/gg.js`, this.headers());
    const b = text.match(/b:\s*'([^']+)'/)?.[1] ?? "";
    const cases = new Set<number>();
    for (const m of text.matchAll(/case\s+(\d+):/g)) cases.add(parseInt(m[1]!, 10));
    const value: Gg = { b, cases };
    this.gg = { at: Date.now(), value };
    return value;
  }

  /** Full image URL for one file, replicating hitomi's common.js url_from_url_from_hash (no base). */
  private imageUrl(gg: Gg, hash: string, ext: "webp" | "avif"): string {
    // s(hash): parseInt(lastChar + previousTwo, 16) — both the path key and the subdomain selector.
    const m = /(..)(.)$/.exec(hash)!;
    const g = parseInt(m[2]! + m[1]!, 16);
    const sub = (ext === "webp" ? "w" : "a") + (1 + (gg.cases.has(g) ? 1 : 0));
    return `https://${sub}.${D2}/${gg.b}${g}/${hash}.${ext}`;
  }

  // ── Byte-range reads ────────────────────────────────────────────────────────

  /** One range request. Returns the bytes plus the resource's total length (from `Content-Range`). */
  private async rangeBytes(
    url: string,
    start: number,
    endInclusive: number,
  ): Promise<{ bytes: Uint8Array; total?: number }> {
    const res = await this.request({
      url,
      headers: { ...this.headers(), Range: `bytes=${start}-${endInclusive}` },
      responseType: "base64",
    });
    // 404 (no such tag/area) or 416 (past the end) → nothing there, not an error.
    if (res.status === 404 || res.status === 416) return { bytes: new Uint8Array(0) };
    if (res.status >= 400) throw new Error(`range ${url}: HTTP ${res.status}`);
    const total = Number(res.headers["content-range"]?.match(/\/(\d+)$/)?.[1]);
    return { bytes: base64ToBytes(res.body), ...(Number.isFinite(total) ? { total } : {}) };
  }

  /**
   * Byte length of a nozomi index, via a 1-byte range read: the `Content-Range` total tells us the
   * id count without transferring the list. This is what the size guard decides on.
   */
  private async nozomiSize(url: string): Promise<number> {
    const cached = this.nozomiSizes.get(url);
    if (cached !== undefined) return cached;
    const { total } = await this.rangeBytes(url, 0, 0);
    const size = total ?? 0;
    this.nozomiSizes.set(url, size);
    return size;
  }

  /** Download a whole nozomi index as an id set. Only ever called on terms inside the size guard. */
  private async nozomiSet(url: string, size: number): Promise<Set<number>> {
    if (size <= 0) return new Set();
    const { bytes } = await this.rangeBytes(url, 0, size - 1);
    return new Set(idsFromBytes(bytes));
  }

  // ── Full-text search (galleriesindex B-tree) ────────────────────────────────

  private async ftsIndexVersion(): Promise<string> {
    if (this.ftsVersion && Date.now() - this.ftsVersion.at < INDEX_VERSION_TTL_MS) return this.ftsVersion.value;
    const value = (await this.fetchText(`${LTN}/galleriesindex/version`, this.headers())).trim();
    this.ftsVersion = { at: Date.now(), value };
    return value;
  }

  /**
   * Resolve a free-text term to gallery ids through hitomi's `galleriesindex` B-tree, mirroring
   * `search.js`'s `B_search`. The key is the first 4 bytes of sha256(term); nodes are a fixed 464
   * bytes with up to B=16 children, so a lookup is a handful of range reads into a ~1.9 GB index.
   */
  private async ftsIds(term: string): Promise<number[]> {
    const version = await this.ftsIndexVersion();
    const indexUrl = `${LTN}/galleriesindex/galleries.${version}.index`;
    const key = sha256(term).slice(0, 4);

    let address = 0;
    for (let depth = 0; depth <= 12; depth++) {
      const { bytes } = await this.rangeBytes(indexUrl, address, address + FTS_NODE_SIZE - 1);
      if (bytes.byteLength < FTS_NODE_SIZE) return [];
      const node = this.decodeFtsNode(bytes);
      if (!node) return [];

      let i = 0;
      let cmp = -1;
      for (; i < node.keys.length; i++) {
        cmp = compareBytes(key, node.keys[i]!);
        if (cmp <= 0) break;
      }
      if (cmp === 0) {
        const data = node.datas[i];
        return data ? this.ftsData(version, data[0], data[1]) : [];
      }
      // A leaf (all child pointers zero) that didn't match means the term isn't indexed.
      const next = node.subs[i];
      if (!next) return [];
      address = next;
    }
    return [];
  }

  private decodeFtsNode(
    data: Uint8Array,
  ): { keys: Uint8Array[]; datas: Array<[number, number]>; subs: number[] } | undefined {
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let pos = 0;
    const nKeys = v.getInt32(pos, false);
    pos += 4;
    if (nKeys < 0 || nKeys > FTS_B) return undefined;
    const keys: Uint8Array[] = [];
    for (let i = 0; i < nKeys; i++) {
      const size = v.getInt32(pos, false);
      pos += 4;
      if (size <= 0 || size > 32) return undefined;
      keys.push(data.slice(pos, pos + size));
      pos += size;
    }
    const nDatas = v.getInt32(pos, false);
    pos += 4;
    if (nDatas < 0 || nDatas > FTS_B) return undefined;
    const datas: Array<[number, number]> = [];
    for (let i = 0; i < nDatas; i++) {
      const offset = getU64(v, pos);
      pos += 8;
      const length = v.getInt32(pos, false);
      pos += 4;
      datas.push([offset, length]);
    }
    const subs: number[] = [];
    for (let i = 0; i < FTS_B + 1; i++) {
      subs.push(getU64(v, pos));
      pos += 8;
    }
    return { keys, datas, subs };
  }

  /** The id list a matched B-tree key points at: an int32 count followed by that many int32 ids. */
  private async ftsData(version: string, offset: number, length: number): Promise<number[]> {
    if (length <= 0) return [];
    const { bytes } = await this.rangeBytes(`${LTN}/galleriesindex/galleries.${version}.data`, offset, offset + length - 1);
    if (bytes.byteLength < 4) return [];
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const count = v.getInt32(0, false);
    const ids: number[] = [];
    for (let i = 0; i < count && 4 + i * 4 + 4 <= bytes.byteLength; i++) ids.push(v.getInt32(4 + i * 4, false));
    return ids;
  }

  // ── Cards (galleryblock) ────────────────────────────────────────────────────

  /**
   * Parse one galleryblock into a display entry plus its full facet set. Every taxonomy link on the
   * card becomes a `namespace:value` id, which is what both tag redaction and demoted query terms
   * test against — so neither costs an extra request.
   */
  private async fetchCard(id: number): Promise<Card | null> {
    try {
      const $ = this.parse(await this.fetchText(`${LTN}/galleryblock/${id}.html`, this.headers()));
      const title = ($("h1.lillie a").first().text() || $(".lillie a").first().text()).trim();
      if (!title) return null;

      const facets = new Set<string>();
      $("a[href]").each((_i, el) => {
        const facet = tagIdFromUrl($(el).attr("href"));
        if (facet) facets.add(facet);
      });

      const entry: SeriesEntry = { id: String(id), title };
      // The card's cover hash rides along in the thumbnail img/source; proxy it (Referer-gated).
      const raw = $("img.lazyload").first().attr("data-src");
      const hash = raw?.match(/([0-9a-f]{64})\.\w+$/)?.[1];
      if (hash) entry.thumbnailUrl = this.proxied(this.coverUrl(hash));

      const artists = $(".artist-list a")
        .map((_i, el) => $(el).text().trim())
        .get()
        .filter((s) => s.length > 0);
      if (artists.length) entry.subtitle = artists.join(", ");

      // The card's Language row prints the *localized* name ("日本語"), which doesn't abbreviate; the
      // `/index-japanese.html` href beside it gives the English name, already parsed into `facets`.
      for (const facet of facets) {
        if (facet.startsWith("language:")) {
          entry.badges = [{ text: abbreviateLanguage(facet.slice(9)), position: "bottom-right", tone: "info" }];
          break;
        }
      }

      return { entry, facets };
    } catch {
      return null; // a deleted/expunged gallery — skip its card rather than fail the page
    }
  }

  /** Cached card lookup. Bounded, insertion-ordered eviction. */
  private async card(id: number): Promise<Card | null> {
    const hit = this.cardCache.get(id);
    if (hit !== undefined) return hit;
    const card = await this.fetchCard(id);
    if (this.cardCache.size >= CARD_CACHE_MAX) {
      const oldest = this.cardCache.keys().next();
      if (!oldest.done) this.cardCache.delete(oldest.value);
    }
    this.cardCache.set(id, card);
    return card;
  }

  /**
   * Apply persistent tag exclusion (capability "exclude-tags"). The card already carries the full
   * tag list, so this is free. We keep the slot but strip the title and thumbnail: the host shows a
   * blank placeholder and never fetches a cover.
   */
  private redact(card: Card, excluded: Set<string> | undefined): SeriesEntry {
    if (excluded?.size) {
      for (const facet of card.facets) {
        if (excluded.has(facet)) return { id: card.entry.id, title: REDACTED_TITLE, excluded: true };
      }
    }
    return card.entry;
  }

  private async idsToEntries(ids: number[], excluded?: Set<string>): Promise<SeriesEntry[]> {
    const cards = await Promise.all(ids.map((id) => this.card(id)));
    return cards.filter((c): c is Card => c !== null).map((c) => this.redact(c, excluded));
  }

  /** Build the excluded-tag-id set from injected options (`namespace:value`, as `getTags()` returns). */
  private excludedSet(options?: { excludedTags?: string[] }): Set<string> | undefined {
    const ids = options?.excludedTags;
    if (!ids?.length) return undefined;
    const set = new Set(ids.map((s) => String(s).trim().toLowerCase()).filter(Boolean));
    return set.size ? set : undefined;
  }

  // ── Query resolution ────────────────────────────────────────────────────────

  private termUrl(term: Term, q: ParsedQuery): string | undefined {
    const area = termArea(term);
    if (!area) return undefined;
    return nozomiUrl(LTN, area.area, area.tag, q.language, q.sort);
  }

  /**
   * Turn a parsed query into an executable plan.
   *
   * The cheapest positive term becomes the `base`, and a nozomi base is *byte-range paged* rather
   * than downloaded — so even "no positive terms at all" (base = the whole `index` for the chosen
   * ordering) costs one small request per page. Every other term is either downloaded as a set (when
   * it fits the size guard) or, if its namespace shows up on a galleryblock, demoted to a per-card
   * predicate. Free-text terms always go through the B-tree.
   */
  private async plan(q: ParsedQuery): Promise<Resolved> {
    const intersect: Set<number>[] = [];
    const subtract: Set<number>[] = [];
    const lateInclude: string[][] = [];
    const lateExclude: string[] = [];

    // Free-text positives resolve to (usually small) id arrays up front.
    const ftsSets: number[][] = [];
    for (const term of q.positive) {
      if (!term.ns) ftsSets.push(await this.ftsIds(term.value));
    }
    // A free-text term with no hits means an empty result, full stop.
    if (ftsSets.some((s) => s.length === 0)) {
      return { base: { kind: "array", ids: [] }, intersect, subtract, lateInclude, lateExclude, simple: true };
    }

    // Size-probe every namespaced positive so we can pick the cheapest as the base.
    const nozomiPositives: Array<{ term: Term; url: string; size: number }> = [];
    await Promise.all(
      q.positive
        .filter((t) => t.ns)
        .map(async (term) => {
          const url = this.termUrl(term, q);
          if (!url) return;
          nozomiPositives.push({ term, url, size: await this.nozomiSize(url) });
        }),
    );
    // A namespaced term that resolves to an empty index means an empty result.
    if (nozomiPositives.some((p) => p.size === 0)) {
      return { base: { kind: "array", ids: [] }, intersect, subtract, lateInclude, lateExclude, simple: true };
    }
    nozomiPositives.sort((a, b) => a.size - b.size);

    // Pick the base. Prefer the smallest free-text set (already in memory, and typically far smaller
    // than any index); otherwise the smallest namespaced term, range-paged.
    ftsSets.sort((a, b) => a.length - b.length);
    let base: IdSource;
    let usedFts = 0;
    let usedNozomi = 0;
    const smallestFts = ftsSets[0];
    const smallestNozomi = nozomiPositives[0];
    if (smallestFts && (!smallestNozomi || smallestFts.length * 4 < smallestNozomi.size)) {
      base = { kind: "array", ids: smallestFts };
      usedFts = 1;
    } else if (smallestNozomi) {
      base = { kind: "nozomi", url: smallestNozomi.url, total: Math.floor(smallestNozomi.size / 4) };
      usedNozomi = 1;
    } else {
      // No positive terms: browse the whole ordering (`index-{language}` for date, `popular/week-…`).
      const url = nozomiUrl(LTN, "all", "index", q.language, q.sort);
      base = { kind: "nozomi", url, total: Math.floor((await this.nozomiSize(url)) / 4) };
    }

    // Remaining free-text positives intersect directly.
    for (const ids of ftsSets.slice(usedFts)) intersect.push(new Set(ids));

    // Remaining namespaced positives: download, or demote to a card predicate when oversized.
    for (const { term, url, size } of nozomiPositives.slice(usedNozomi)) {
      const id = tagId(term.ns, term.value);
      if (size > MAX_TERM_BYTES && CARD_VISIBLE_NS.has(term.ns)) lateInclude.push([id]);
      else intersect.push(await this.nozomiSet(url, size));
    }

    // Negatives, same guard.
    for (const term of q.negative) {
      if (!term.ns) {
        subtract.push(new Set(await this.ftsIds(term.value)));
        continue;
      }
      const url = this.termUrl(term, q);
      if (!url) continue;
      const id = tagId(term.ns, term.value);
      if (CARD_VISIBLE_NS.has(term.ns)) {
        const size = await this.nozomiSize(url);
        if (size === 0) continue; // nothing to subtract
        if (size > MAX_TERM_BYTES) {
          lateExclude.push(id);
          continue;
        }
        subtract.push(await this.nozomiSet(url, size));
      } else {
        const size = await this.nozomiSize(url);
        if (size > 0) subtract.push(await this.nozomiSet(url, size));
      }
    }

    // OR groups: union the members when they all fit, else demote the whole group.
    for (const group of q.orGroups) {
      const members = group.filter((t) => t.ns || t.value);
      if (!members.length) continue;
      const sized = await Promise.all(
        members.map(async (term) => {
          if (!term.ns) return { term, url: undefined, size: 0 };
          const url = this.termUrl(term, q);
          return { term, url, size: url ? await this.nozomiSize(url) : 0 };
        }),
      );
      const oversized = sized.some((s) => s.url && s.size > MAX_TERM_BYTES);
      if (oversized && members.every((t) => t.ns && CARD_VISIBLE_NS.has(t.ns))) {
        lateInclude.push(members.map((t) => tagId(t.ns, t.value)));
        continue;
      }
      const union = new Set<number>();
      for (const { term, url, size } of sized) {
        if (!url) {
          for (const id of await this.ftsIds(term.value)) union.add(id);
        } else if (size > 0) {
          for (const id of await this.nozomiSet(url, size)) union.add(id);
        }
      }
      intersect.push(union);
    }

    const simple =
      intersect.length === 0 && subtract.length === 0 && lateInclude.length === 0 && lateExclude.length === 0;
    return { base, intersect, subtract, lateInclude, lateExclude, simple };
  }

  // ── Scanning / paging ───────────────────────────────────────────────────────

  private sourceTotal(src: IdSource): number {
    return src.kind === "array" ? src.ids.length : src.total;
  }

  /** Read `count` ids starting at `start` in the source's own (descending) order. */
  private async readAt(src: IdSource, start: number, count: number): Promise<number[]> {
    if (count <= 0 || start < 0) return [];
    if (src.kind === "array") return src.ids.slice(start, start + count);
    const { bytes } = await this.rangeBytes(src.url, start * 4, (start + count) * 4 - 1);
    return idsFromBytes(bytes);
  }

  /**
   * Read one window honouring the sort direction. `asc` reads mirrored from the tail (hitomi only
   * publishes descending indexes); `random` jumps to a pseudorandom offset that's stable for a given
   * query + position, so re-fetching a page doesn't reshuffle it.
   */
  private async readWindow(src: IdSource, offset: number, count: number, q: ParsedQuery, sig: string): Promise<number[]> {
    const total = this.sourceTotal(src);
    if (offset >= total) return [];
    const n = Math.min(count, total - offset);
    if (q.sort.direction === "random") {
      const span = Math.max(0, total - n);
      const start = span === 0 ? 0 : Math.floor(seededRandom(hashString(sig) ^ offset) * span);
      return this.readAt(src, start, n);
    }
    if (q.sort.direction === "asc") {
      const ids = await this.readAt(src, total - offset - n, n);
      return ids.reverse();
    }
    return this.readAt(src, offset, n);
  }

  /**
   * Collect one page of ids for a resolved query.
   *
   * With no filters this is a single range read (the common "browse a tag/list" case). Otherwise it
   * scans the base, applying set membership first (free) and card predicates last (one galleryblock
   * each, cached and reused when the page is built), remembering its progress per query signature so
   * paging forward doesn't rescan.
   */
  private async collect(q: ParsedQuery, plan: Resolved, page: number): Promise<{ ids: number[]; hasNext: boolean }> {
    const sig = querySignature(q);
    const total = this.sourceTotal(plan.base);

    if (plan.simple) {
      const offset = (page - 1) * PER_PAGE;
      const ids = await this.readWindow(plan.base, offset, PER_PAGE, q, sig);
      // `random` never runs out: every page is a fresh window into the same index.
      const hasNext = q.sort.direction === "random" ? ids.length > 0 : offset + ids.length < total;
      return { ids, hasNext };
    }

    let cursor = this.cursors.get(sig);
    if (!cursor || Date.now() - cursor.at > CURSOR_TTL_MS) {
      cursor = { at: Date.now(), ids: [], seen: new Set(), scanned: 0 };
      this.cursors.set(sig, cursor);
    }
    // `random` picks an independent window per iteration, so windows can overlap; every other
    // direction walks the base in order and can't. Dedupe unconditionally — a page must never
    // repeat an id, and a Set membership test is far cheaper than the request that produced it.
    const accept = (id: number) => {
      if (cursor!.seen.has(id)) return;
      cursor!.seen.add(id);
      cursor!.ids.push(id);
    };

    const need = page * PER_PAGE;
    const needsCards = plan.lateInclude.length > 0 || plan.lateExclude.length > 0;
    let cardsFetched = 0;

    while (cursor.ids.length <= need && cursor.scanned < total) {
      if (needsCards && cardsFetched >= MAX_CARDS_PER_PAGE) break;
      const chunk = await this.readWindow(plan.base, cursor.scanned, SCAN_CHUNK, q, sig);
      if (!chunk.length) break;
      cursor.scanned += chunk.length;

      let candidates = chunk;
      for (const set of plan.intersect) candidates = candidates.filter((id) => set.has(id));
      for (const set of plan.subtract) candidates = candidates.filter((id) => !set.has(id));

      if (!needsCards) {
        for (const id of candidates) accept(id);
        continue;
      }
      const cards = await Promise.all(candidates.map((id) => this.card(id)));
      cardsFetched += candidates.length;
      candidates.forEach((id, i) => {
        const card = cards[i];
        if (!card) return;
        for (const clause of plan.lateInclude) {
          if (!clause.some((t) => card.facets.has(t))) return;
        }
        for (const t of plan.lateExclude) {
          if (card.facets.has(t)) return;
        }
        accept(id);
      });
    }
    cursor.at = Date.now();

    const start = (page - 1) * PER_PAGE;
    const ids = cursor.ids.slice(start, start + PER_PAGE);
    const hasNext = cursor.ids.length > start + PER_PAGE || cursor.scanned < total;
    return { ids, hasNext };
  }

  /** Resolve → collect → cards. The single entry point behind both search and list browsing. */
  private async run(q: ParsedQuery, page: number, excluded: Set<string> | undefined): Promise<PagedResults<SeriesEntry>> {
    const plan = await this.plan(q);
    const { ids, hasNext } = await this.collect(q, plan, page);
    return { items: await this.idsToEntries(ids, excluded), page, hasNextPage: hasNext };
  }

  // ── Filters / sort ───────────────────────────────────────────────────────────

  async getFilters(): Promise<Filter[]> {
    return [
      { type: "tag-multiselect", key: "tags", label: "Tags", excludable: true },
      { type: "multiselect", key: "type", label: "Type", excludable: true, options: [...TYPES] },
      { type: "select", key: "language", label: "Language", options: [...LANGUAGES] },
      { type: "text", key: "artist", label: "Artist" },
      { type: "text", key: "series", label: "Series" },
      { type: "text", key: "character", label: "Character" },
      { type: "text", key: "group", label: "Circle / Group" },
    ];
  }

  async getSortOptions(): Promise<SortOption[]> {
    // Ascending is real for every ordering (hitomi only publishes descending indexes, so `readWindow`
    // mirrors the read off the tail) — except `random`, where a direction means nothing.
    return SORTS.map((s) =>
      s.state.direction === "random" ? { key: s.key, label: s.label, directionless: true } : { key: s.key, label: s.label },
    );
  }

  /**
   * Fold filter values into a parsed query. Comma-separated text filters accept a `-` prefix per
   * entry (`-shindol`) to negate, matching the query language's own syntax.
   */
  private applyFilters(q: ParsedQuery, options?: { filters?: SearchOptions["filters"]; sort?: SearchOptions["sort"] }): void {
    const sort = SORTS.find((s) => s.key === options?.sort?.key);
    if (sort) {
      q.sort = { ...sort.state };
      // `random` ignores direction; everything else honours it (ascending reads off the index tail).
      if (q.sort.direction !== "random" && options?.sort?.ascending) q.sort.direction = "asc";
    }

    for (const f of options?.filters ?? []) {
      if (f.key === "language") {
        if (typeof f.value === "string" && f.value) q.language = f.value;
        continue;
      }
      if (f.key === "tags") {
        const { include, exclude } = parseFilterIncludeExclude(f.value);
        for (const id of include) {
          const term = termFromId(id);
          if (!term) continue;
          // Same hoist `parseQuery` does for a typed `language:x`: it's a dimension of every nozomi
          // path, not a set to intersect (as a term it would resolve to the whole unfiltered index).
          if (term.ns === "language") q.language = term.value;
          else q.positive.push(term);
        }
        for (const id of exclude) {
          const term = termFromId(id);
          // An excluded language can't be hoisted (the path holds one language), but `language` is
          // card-visible, so `plan()` turns it into a per-card predicate.
          if (term) q.negative.push(term);
        }
        continue;
      }
      if (f.key === "type") {
        const { include, exclude } = parseFilterIncludeExclude(f.value);
        // Several included types are an OR, not an intersection — nothing is two types at once.
        if (include.length > 1) q.orGroups.push(include.map((t) => ({ ns: "type", value: t })));
        else if (include[0]) q.positive.push({ ns: "type", value: include[0] });
        for (const t of exclude) q.negative.push({ ns: "type", value: t });
        continue;
      }
      if ((f.key === "artist" || f.key === "series" || f.key === "character" || f.key === "group") && typeof f.value === "string") {
        for (const raw of f.value.split(",")) {
          const entry = raw.trim().toLowerCase();
          if (!entry) continue;
          if (entry.startsWith("-")) {
            const value = entry.slice(1).trim();
            if (value) q.negative.push({ ns: f.key, value });
          } else {
            q.positive.push({ ns: f.key, value: entry });
          }
        }
      }
    }

    // Re-apply the parser's ordering guarantee: namespaced positives make cheaper base sets.
    q.positive.sort((a, b) => (a.ns ? 0 : 1) - (b.ns ? 0 : 1));
  }

  // ── Lists ──────────────────────────────────────────────────────────────────

  async getLists(): Promise<SeriesList[]> {
    return LISTS.map(({ sort: _s, ...list }) => list);
  }

  async getListItems(listId: string, page: number, options?: ListOptions): Promise<PagedResults<SeriesEntry>> {
    const list = LISTS.find((l) => l.id === listId);
    if (!list) throw new Error(`unknown list: ${listId}`);

    // A list is just a default ordering over the whole index, so it runs through the same engine —
    // which is what lets the language filter, an in-list query and tag exclusion apply while browsing.
    const q = parseQuery(options?.query ?? "");
    q.sort = { ...(SORTS.find((s) => s.key === list.sort)?.state ?? DEFAULT_SORT) };
    this.applyFilters(q, options);
    return this.run(q, page, this.excludedSet(options));
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  async getSearchResults(query: string, page: number, options?: SearchOptions): Promise<PagedResults<SeriesEntry>> {
    const q = parseQuery(query);
    this.applyFilters(q, options);
    return this.run(q, page, this.excludedSet(options));
  }

  // ── Tags ───────────────────────────────────────────────────────────────────

  /**
   * Tag autocomplete against `tagindex.hitomi.la`, the same source the site's search box uses. The
   * query is spelled out one character per path segment (`/global/f/u/l/l.json`), with the site's
   * `encode_search_query_for_url` escapes; an empty query hits `global.json`, hitomi's top-tags list.
   * Results carry a usage count, which goes into the label so a picker can show how broad a tag is.
   */
  async getTags(query = ""): Promise<Tag[]> {
    const term = query.trim().toLowerCase().replace(/_/g, " ");
    // `ns:partial` narrows to that namespace's index, matching the site's behaviour.
    const colon = term.indexOf(":");
    const field = colon > 0 ? term.slice(0, colon) : "global";
    const text = colon > 0 ? term.slice(colon + 1) : term;

    const chars = [...text].map((c) => (c === " " ? "_" : c === "/" ? "slash" : c === "." ? "dot" : encodeURIComponent(c)));
    const url = `${TAGINDEX}/${field}${chars.length ? `/${chars.join("/")}` : ""}.json`;
    try {
      const rows = await this.fetchJson<Array<[string, number, string]>>(url, this.headers());
      return (rows ?? []).slice(0, 60).map(([name, count, ns]) => {
        const id = tagId(ns, name);
        return { id, label: count > 0 ? `${tagLabel(id)} (${count.toLocaleString("en-US")})` : tagLabel(id) };
      });
    } catch {
      return [];
    }
  }

  /**
   * Reverse lookup for persisted exclusions. Tag ids are self-describing (`female:yuri`), so unlike
   * a numeric-id backend this needs no network at all.
   */
  async resolveTags(ids: string[]): Promise<Tag[]> {
    return ids
      .map((raw) => raw.trim().toLowerCase())
      .filter((id) => id.includes(":"))
      .map((id) => ({ id, label: tagLabel(id) }));
  }

  // ── Series detail ─────────────────────────────────────────────────────────────

  private async fetchGallery(id: string): Promise<GalleryInfo> {
    if (this.lastGallery?.id === id) return this.lastGallery.value;
    const text = await this.fetchText(`${LTN}/galleries/${encodeURIComponent(id)}.js`, this.headers());
    // The file is `var galleryinfo = { … }` — strip the assignment prefix, parse the object.
    const value = JSON.parse(text.replace(/^var\s+galleryinfo\s*=\s*/, "")) as GalleryInfo;
    this.lastGallery = { id, value };
    return value;
  }

  async getSeriesDetails(seriesId: string): Promise<SeriesInfo> {
    const g = await this.fetchGallery(seriesId);

    const info: SeriesInfo = { id: seriesId, title: g.title || seriesId };
    if (g.files[0]?.hash) info.thumbnailUrl = this.proxied(this.coverUrl(g.files[0].hash));
    if (g.type) info.type = TYPE_LABELS[g.type] ?? g.type;
    if (g.files.length) info.pageCount = g.files.length;

    // Every language this work exists in (see HitomiLanguage) — this gallery's own included.
    const languages = new Set<string>();
    if (g.language_localname || g.language) languages.add(g.language_localname || g.language!);
    for (const l of g.languages ?? []) {
      const name = l.language_localname || l.name;
      if (name) languages.add(name);
    }
    if (languages.size) info.languages = [...languages];

    const artists = (g.artists ?? []).map((a) => a.artist).filter((n): n is string => !!n);
    if (artists.length) {
      info.author = artists.join(", ");
      info.authors = artists.map((name) => ({ name }));
    }

    const description = this.buildDescription(g);
    if (description) info.description = description;

    // Each taxonomy becomes a tag group whose chips carry a ready-to-run search term, so tapping a
    // chip browses that tag/artist/series/character.
    const tagGroups: TagGroup[] = [];
    const push = (label: string, kind: TagGroup["kind"], entries: Array<{ name: string; id: string }>) => {
      if (!entries.length) return;
      const group: TagGroup = { label, tags: entries.map((e) => e.name), tagQueries: entries.map((e) => tagQuery(e.id)) };
      if (kind) group.kind = kind;
      tagGroups.push(group);
    };

    if (g.type) push("Type", "genre", [{ name: TYPE_LABELS[g.type] ?? g.type, id: tagId("type", g.type) }]);

    const themeTags: Array<{ name: string; id: string }> = [];
    for (const t of g.tags ?? []) {
      if (!t.tag) continue;
      const ns = t.female === "1" ? "female" : t.male === "1" ? "male" : "tag";
      const prefix = ns === "female" ? "♀ " : ns === "male" ? "♂ " : "";
      themeTags.push({ name: prefix + t.tag, id: tagId(ns, t.tag) });
    }
    push("Tags", "theme", themeTags);

    push("Artists", undefined, artists.map((name) => ({ name, id: tagId("artist", name) })));
    push(
      "Series",
      undefined,
      (g.parodys ?? []).flatMap((p) => (p.parody ? [{ name: p.parody, id: tagId("series", p.parody) }] : [])),
    );
    push(
      "Characters",
      undefined,
      (g.characters ?? []).flatMap((c) => (c.character ? [{ name: c.character, id: tagId("character", c.character) }] : [])),
    );
    push(
      "Groups",
      undefined,
      (g.groups ?? []).flatMap((c) => (c.group ? [{ name: c.group, id: tagId("group", c.group) }] : [])),
    );
    if (tagGroups.length) info.tagGroups = tagGroups;

    return info;
  }

  /** Hitomi has no synopsis, so compose the metadata the detail page can't show structurally. */
  private buildDescription(g: GalleryInfo): string | undefined {
    const lines: string[] = [];
    if (g.japanese_title) lines.push(g.japanese_title);
    const parodys = (g.parodys ?? []).map((p) => p.parody).filter((n): n is string => !!n && n !== "original");
    if (parodys.length) lines.push(`Series: ${parodys.join(", ")}`);
    const characters = (g.characters ?? []).map((c) => c.character).filter((n): n is string => !!n);
    if (characters.length) lines.push(`Characters: ${characters.join(", ")}`);
    const groups = (g.groups ?? []).map((c) => c.group).filter((n): n is string => !!n);
    if (groups.length) lines.push(`Circle: ${groups.join(", ")}`);
    const published = g.datepublished?.slice(0, 10);
    if (published) lines.push(`Published: ${published}`);
    const posted = g.date?.slice(0, 10);
    if (posted) lines.push(`Added: ${posted}`);
    return lines.length ? lines.join("\n") : undefined;
  }

  // ── Related series (lazy) ──────────────────────────────────────────────────────

  /**
   * Two rails, both from the gallery JSON we already hold:
   *  - "Related" — hitomi's own similar-gallery list (the site's "related" section).
   *  - "Other languages" — the same work in other languages. The site tucks these into the navbar's
   *    language dropdown rather than the page, but each is its own gallery id, so as cards they're
   *    the most useful thing on the page for a reader who wants a different translation.
   */
  async getRelatedSeries(seriesId: string): Promise<RelatedSeriesGroup[]> {
    const g = await this.fetchGallery(seriesId);
    const groups: RelatedSeriesGroup[] = [];

    const otherLanguages = (g.languages ?? [])
      .map((l) => Number(l.galleryid))
      .filter((id) => Number.isFinite(id) && id > 0 && String(id) !== String(seriesId));
    if (otherLanguages.length) {
      const series = await this.idsToEntries(otherLanguages);
      if (series.length) groups.push({ label: "Other languages", kind: "alternative", series });
    }

    if (g.related?.length) {
      const series = await this.idsToEntries(g.related);
      if (series.length) groups.push({ label: "Related", kind: "similar", series });
    }

    return groups;
  }

  // ── Direct pages ────────────────────────────────────────────────────────────

  async getSeriesPages(seriesId: string): Promise<Page[]> {
    const [g, gg] = await Promise.all([this.fetchGallery(seriesId), this.getGg()]);
    return g.files.map((f, index): Page => {
      const ext: "webp" | "avif" = f.hasavif ? "avif" : "webp";
      return {
        index,
        imageUrl: this.proxied(this.imageUrl(gg, f.hash, ext)),
        thumbnail: { kind: "image", url: this.proxied(this.pageThumbUrl(f.hash)) },
      };
    });
  }
}

/** `female:yuri` → a search term. The inverse of `tagId`. */
function termFromId(id: string): Term | undefined {
  const colon = id.indexOf(":");
  if (colon <= 0) return undefined;
  const value = id.slice(colon + 1).trim();
  return value ? { ns: id.slice(0, colon), value } : undefined;
}

/** Lexicographic compare of two byte strings, as the B-tree orders its keys. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const top = Math.min(a.length, b.length);
  for (let i = 0; i < top; i++) {
    if (a[i]! < b[i]!) return -1;
    if (a[i]! > b[i]!) return 1;
  }
  return 0;
}

export default defineBridge((host) => new HitomiBridge(host));
