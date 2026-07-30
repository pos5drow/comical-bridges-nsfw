/**
 * E-Hentai bridge — https://e-hentai.org / https://exhentai.org
 *
 * Gallery-oriented site (doujinshi, manga, artist CGs, …). Galleries have no chapter
 * structure, so this bridge uses the "direct" capability: `getSeriesPages` returns a
 * flat list of image URLs for each gallery.
 *
 * Auth is cookie-based: the user pastes their e-hentai session cookies into the
 * settings field. Without auth, browsing is limited to the default content filter.
 * ExHentai (sadpanda) additionally requires a valid `igneous` cookie.
 *
 * API surface:
 *  - Gallery listing/search: HTML scraping of /?f_search=Q, walked via the site's ?next=GID seek link
 *  - Gallery metadata: JSON via POST api.e-hentai.org/api.php (gdata method)
 *  - Page image URLs: gallery viewer HTML for filehashes + showpage API per image
 */
import {
  BridgeBase,
  type BridgeInfo,
  type CardBadge,
  type Filter,
  type InferSettings,
  type ListRequest,
  type Page,
  type PageThumbnail,
  type PagedRequest,
  type PagedResults,
  type SearchRequest,
  type SeriesEntry,
  type SeriesInfo,
  type SeriesList,
  type SettingDescriptor,
  type TagGroup,
  type TagKind,
  abbreviateLanguage,
  decodeCursor,
  defineBridge,
  defineSettings,
  encodeCursor,
} from "@comical/sdk";

const EH_BASE = "https://e-hentai.org";
const EX_BASE = "https://exhentai.org";
const EH_API = "https://api.e-hentai.org/api.php";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// f_cats is a bitmask of **excluded** categories; 0 = show all.
// To show only selected categories: f_cats = ALL_CATS_MASK ^ selected_bits.
const CAT_BITS: Record<string, number> = {
  misc: 1,
  doujinshi: 2,
  manga: 4,
  "artist-cg": 8,
  "game-cg": 16,
  "image-set": 32,
  cosplay: 64,
  "asian-porn": 128,
  "non-h": 256,
  western: 512,
};
const ALL_CATS_MASK = Object.values(CAT_BITS).reduce((a, b) => a | b, 0); // 1023

// ── Settings ──────────────────────────────────────────────────────────────────

const SETTINGS = defineSettings([
  {
    type: "string",
    key: "cookies",
    label: "Cookies",
    description:
      "Your e-hentai session cookies (needed for favorites and ExHentai). On a browser where you're " +
      "logged in, open DevTools → Application → Cookies and copy ipb_member_id and ipb_pass_hash " +
      "(add igneous for ExHentai). You can paste the whole cookie string — only those are used.",
    secret: true,
  },
  {
    type: "boolean",
    key: "exhentai",
    label: "Use ExHentai (Sadpanda)",
    description:
      "Browse exhentai.org instead of e-hentai.org. Requires an account that has ExHentai access.",
    default: false,
  },
  {
    type: "enum",
    key: "favcat",
    label: "Default favorites category",
    description:
      "Which of your 10 favorite categories (0–9) new favorites are added to. " +
      "Browsing always shows all categories merged.",
    options: Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: String(i) })),
    default: "0",
  },
]);
type Settings = InferSettings<typeof SETTINGS>;

// ── DTOs ──────────────────────────────────────────────────────────────────────

interface GMetadata {
  gid: number;
  token: string;
  title: string;
  title_jpn?: string;
  category?: string;
  thumb?: string;
  uploader?: string;
  filecount?: string;
  rating?: string;
  tags?: string[];
  error?: string;
  expunged?: boolean;
}

interface GDataResponse {
  gmetadata?: GMetadata[];
}


// ── HTML parsing helpers ──────────────────────────────────────────────────────

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(parseInt(n, 10)));
}

/**
 * Extract ordered { gid, token } pairs from a gallery listing page.
 * Deduplicates so each gallery appears once (every listing card links to its
 * gallery twice — once for the thumbnail, once for the title).
 */
function extractGalleryPairs(html: string): Array<{ gid: number; token: string }> {
  const pairs: Array<{ gid: number; token: string }> = [];
  const seen = new Set<string>();
  const re = /href="https?:\/\/(?:e-hentai|exhentai)\.org\/g\/(\d+)\/([a-f0-9]+)\/"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const key = `${m[1]}:${m[2]}`;
    if (!seen.has(key)) {
      seen.add(key);
      pairs.push({ gid: parseInt(m[1]!, 10), token: m[2]! });
    }
  }
  return pairs;
}

/**
 * Extract the next-page cursor URL from a listing page.
 * E-hentai uses `?next=GID` cursor pagination; the next-page link is the
 * only anchor on the page whose href contains `?next=` or `&next=`.
 *
 * The href is HTML-encoded, so a search's next link looks like
 * `?f_search=q&amp;next=GID`. Decode it — otherwise the literal `&amp;`
 * turns `next` into a bogus `amp;next` param the site ignores, and every
 * "next page" silently re-serves page 1. (The home/popular next link has no
 * extra params, hence no `&amp;`, which is why only searches broke.)
 */
function extractNextUrl(html: string): string | undefined {
  // The `&` separating params is HTML-encoded, so a search cursor reads `...&amp;next=GID`;
  // allow the optional `amp;` so the match succeeds, then decode `&amp;` → `&` for a usable URL.
  const href = html.match(/href=["']([^"']*[?&](?:amp;)?next=\d+[^"']*)["']/)?.[1];
  return href ? decodeEntities(href) : undefined;
}

/** Pull the full image URL from a showpage HTML page. */
function extractImageUrl(fragment: string): string | undefined {
  return (
    fragment.match(/id="img"\s+src="([^"]+)"/)?.[1] ??
    fragment.match(/src="([^"]+)"\s[^>]*id="img"/)?.[1]
  );
}

/** Extract { hash, pageNum } pairs from a gallery viewer page. */
function extractPageHashes(html: string): Array<{ hash: string; pageNum: number }> {
  const re = /href="https?:\/\/(?:e-hentai|exhentai)\.org\/s\/([a-f0-9]+)\/\d+-(\d+)"/g;
  const results: Array<{ hash: string; pageNum: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    results.push({ hash: m[1]!, pageNum: parseInt(m[2]!, 10) });
  }
  return results;
}


// ── Auth helpers ──────────────────────────────────────────────────────────────

/**
 * Parse a pasted cookie blob into a name→value map. Accepts both a tidy
 * "ipb_member_id=…; ipb_pass_hash=…" string and a full `document.cookie` dump (many cookies,
 * possibly newline-separated); only the names the bridge cares about are read by the caller.
 */
export function parseCookieString(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of raw.split(/[;\n]+/)) {
    const s = part.trim();
    if (!s) continue;
    const eq = s.indexOf("=");
    if (eq <= 0) continue;
    const name = s.slice(0, eq).trim();
    const value = s.slice(eq + 1).trim();
    if (value) out[name] = value;
  }
  return out;
}

/** True when a page was served logged-out (e-hentai gates favorites behind a login). */
export function isLoggedOut(html: string): boolean {
  // The explicit gate message, or the IPB login form's username field (only present when signed out).
  return /This page requires you to log on/i.test(html) || /name="UserName"/.test(html);
}

/**
 * Detect whether a gallery is currently favorited from the addfav popup HTML.
 * The popup renders a `favcat` radio per category; the gallery's current slot (0–9) is pre-checked
 * when favorited, otherwise the "favdel" radio is checked. Order-independent within each <input> tag.
 */
export function isFavoritedFromPopup(html: string): boolean {
  for (const m of html.matchAll(/<input[^>]*name="favcat"[^>]*>/gi)) {
    const tag = m[0];
    if (/checked/i.test(tag) && /value="[0-9]"/.test(tag)) return true;
  }
  return false;
}

/** Parse total image count from "Showing 1 - 40 of 185 images" banner. */
function extractFilecount(html: string): number {
  // E-hentai formats counts ≥1000 with commas ("1,110"), so strip them before parsing.
  return parseInt((html.match(/of ([\d,]+) images?/)?.[1] ?? "0").replace(/,/g, ""), 10);
}

// ── Tag helpers ───────────────────────────────────────────────────────────────

/**
 * Language-namespace values that aren't actual languages but translation states; excluded so a card's
 * language badge shows the real language (e.g. "english", not "translated").
 */
const LANG_MODIFIERS: ReadonlySet<string> = new Set([
  "translated", "rewrite", "speechless", "textless", "text cleaned",
]);

/**
 * Card badges for an e-hentai gallery, from its gdata: the category (gallery type, e.g. "Doujinshi")
 * bottom-left, and the primary language as a terse abbreviation ("EN") bottom-right. Both come from
 * metadata already fetched for the card, so there's no extra request.
 */
export function cardBadges(meta: GMetadata): CardBadge[] {
  const badges: CardBadge[] = [];
  if (meta.category) badges.push({ text: meta.category, position: "bottom-left", tone: "neutral" });
  const langs = groupTagsByNs(meta.tags ?? []).get("language") ?? [];
  const lang = langs.find((l) => !LANG_MODIFIERS.has(l.toLowerCase()));
  if (lang) badges.push({ text: abbreviateLanguage(lang), position: "bottom-right", tone: "info" });
  return badges;
}

/** Group gdata tags (format "namespace:value") by namespace. */
function groupTagsByNs(tags: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const t of tags) {
    const colon = t.indexOf(":");
    const ns = colon === -1 ? "misc" : t.slice(0, colon);
    const val = colon === -1 ? t : t.slice(colon + 1);
    let arr = map.get(ns);
    if (!arr) { arr = []; map.set(ns, arr); }
    arr.push(val);
  }
  return map;
}

/**
 * Build the e-hentai search token for a single tag, so a host can drop it straight into the search
 * box. The trailing `$` pins an exact tag match (the site's own tag links do the same). The "misc"
 * namespace is the bridge's bucket for colon-less tags, which have no real e-hentai namespace, so
 * those search unscoped.
 */
function tagSearchToken(ns: string, value: string): string {
  return ns === "misc" ? `"${value}$"` : `${ns}:"${value}$"`;
}

// Namespaces that map to a semantic TagKind; others get no kind.
const TAG_KINDS: Record<string, TagKind> = {
  female: "theme",
  male: "theme",
  tag: "theme",
};

// Human-readable labels for known EH tag namespaces.
const NS_LABELS: Record<string, string> = {
  artist: "Artists",
  group: "Groups",
  parody: "Parodies",
  character: "Characters",
  female: "Female Tags",
  male: "Male Tags",
  tag: "Tags",
  language: "Languages",
  misc: "Misc",
};

// ── Thumbnail helpers ─────────────────────────────────────────────────────────

/** s.exhentai.org thumbnails require the igneous cookie; ehgt.org is the same CDN without auth. */
function normalizeThumbUrl(url: string): string {
  return url.replace(/^https?:\/\/s\.exhentai\.org\/t\//, "https://ehgt.org/");
}

/** Strip the _250 size suffix for a full-resolution cover (used on the detail page only). */
function fullSizeThumbUrl(url: string): string {
  return normalizeThumbUrl(url).replace(/_250\.(\w+)$/, ".$1");
}

/** One sprite tile's geometry: its rect `{x,y,w,h}` inside the sheet at `src`, plus the sheet's own
 *  pixel size `{sheetWidth,sheetHeight}`. The sheet size is what scales the crop, so it must be the
 *  whole sheet — not the tile — or mixed-size galleries crop the wrong region. */
export interface SpriteTile {
  src: string;
  x: number;
  y: number;
  w: number;
  h: number;
  sheetWidth: number;
  sheetHeight: number;
}

/**
 * Parse per-page sprite thumbnails from the gallery viewer HTML.
 * Structure: <a href=".../{gid}-{pageNum}"><div style="width:{w}px;height:{h}px;background:... url({src}) -{x}px [-{y}px] ...">
 * A viewer page can span multiple montage sheets and the tiles can have varying sizes (mixed-aspect
 * galleries) and even sit on a second row, so each sheet is sized from its own tiles' extents.
 */
export function extractViewerThumbnails(html: string): Map<number, SpriteTile> {
  const re = /href="https?:\/\/(?:e-hentai|exhentai)\.org\/s\/[a-f0-9]+\/\d+-(\d+)"><div[^>]+style="width:(\d+)px;height:(\d+)px;background:(?:[a-z]+ )?url\(([^)]+)\)\s*(-?\d+)px(?:\s+(-?\d+)px)?/g;
  const entries: Array<{ pageNum: number; src: string; x: number; y: number; w: number; h: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    entries.push({
      pageNum: parseInt(m[1]!, 10),
      w: parseInt(m[2]!, 10),
      h: parseInt(m[3]!, 10),
      src: m[4]!.trim(),
      x: Math.abs(parseInt(m[5]!, 10)),
      y: m[6] != null ? Math.abs(parseInt(m[6], 10)) : 0,
    });
  }
  // Size each montage sheet from the extents of the tiles that reference it (the bottom-right corner
  // of its furthest tile), keyed by src — never mix dimensions across sheets.
  const sheetW = new Map<string, number>();
  const sheetH = new Map<string, number>();
  for (const e of entries) {
    sheetW.set(e.src, Math.max(sheetW.get(e.src) ?? 0, e.x + e.w));
    sheetH.set(e.src, Math.max(sheetH.get(e.src) ?? 0, e.y + e.h));
  }
  const map = new Map<number, SpriteTile>();
  for (const e of entries) {
    map.set(e.pageNum, {
      src: e.src,
      x: e.x,
      y: e.y,
      w: e.w,
      h: e.h,
      sheetWidth: sheetW.get(e.src)!,
      sheetHeight: sheetH.get(e.src)!,
    });
  }
  return map;
}

/** Describe a sprite tile as slice metadata; the client (web SVG / native region-decode) crops it
 *  from the shared sheet, so the original pixels are preserved (no server-side recompression). */
function spriteThumb(t: SpriteTile): PageThumbnail {
  return {
    kind: "sprite",
    sheetUrl: `/img-proxy?url=${encodeURIComponent(t.src)}`,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    sheetWidth: t.sheetWidth,
    sheetHeight: t.sheetHeight,
  };
}


// ── Bridge ────────────────────────────────────────────────────────────────────

const VIEWER_PAGE_SIZE = 20;

class EHentaiBridge extends BridgeBase<Settings> {
  // Cache for viewer-page hashes: key = `${gid}:${viewerPageIndex}`, value = pageNum → hash.
  // Avoids re-fetching the same viewer page when multiple resolvePage calls land simultaneously.
  private readonly hashCache = new Map<string, Map<number, string>>();
  private readonly hashCachePending = new Map<string, Promise<Map<number, string>>>();
  // Cache for viewer-page sprite thumbnails: same key as hashCache.
  private readonly thumbCache = new Map<string, Map<number, SpriteTile>>();

  readonly info: BridgeInfo = {
    id: "pos5drow.e-hentai",
    name: "E-Hentai",
    version: "0.2.4",
    contractVersion: "1.0.0",
    languages: ["multi"],
    nsfw: true,
    capabilities: ["lists", "search", "filters", "settings", "direct", "favorites"],
    iconUrl: `${EH_BASE}/favicon.ico`,
    rateLimit: { maxConcurrent: 3, minIntervalMs: 500 },
    // Hosts whose assets this bridge serves via the host's `/img-proxy` (montage sprite sheets on
    // the H@H network; the CDN thumbnail hosts are covered too though covers load direct today).
    // The host derives its proxy allowlist from this — it hardcodes no source hostnames. The Referer
    // some of these backends expect is sent by the host on our behalf.
    assetProxy: {
      hosts: ["ehgt.org", "exhentai.org", "hath.network"],
      referer: `${EH_BASE}/`,
    },
  };

  getSettings(): SettingDescriptor[] {
    return [...SETTINGS];
  }

  private base(): string {
    return this.setting("exhentai") ? EX_BASE : EH_BASE;
  }

  private headers(forHtml = false): Record<string, string> {
    return {
      "User-Agent": UA,
      Accept: forHtml
        ? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
        : "application/json, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Cookie: this.cookieHeader(),
    };
  }

  private resolveUrl(href: string): string {
    return href.startsWith("http") ? href : this.base() + href;
  }

  private async getHtml(url: string): Promise<string> {
    const res = await this.request({ url, method: "GET", headers: this.headers(true) });
    if (res.status >= 400) throw new Error(`HTTP ${res.status} fetching ${url}`);
    return res.body;
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await this.request({
      url,
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status >= 400) throw new Error(`HTTP ${res.status} from API`);
    return JSON.parse(res.body) as T;
  }

  // ── Auth / session ──────────────────────────────────────────────────────────
  // e-hentai's login is gated by Cloudflare + an adaptive reCAPTCHA that always challenges a headless
  // browser, so there's no way to sign in programmatically. Instead the user pastes the durable session
  // cookies (ipb_member_id / ipb_pass_hash, + igneous for ExHentai) from a browser that's already logged
  // in; we extract and inject them on every request. These are long-lived ("stay logged in") cookies.

  /** The user's pasted cookie blob, parsed to a name→value map. */
  private parsedCookies(): Record<string, string> {
    return parseCookieString(this.setting("cookies") ?? "");
  }

  /** Cookie header for a request: the user's ipb_* (+ igneous) cookies plus the nw=1 warning bypass. */
  private cookieHeader(): string {
    const c = this.parsedCookies();
    const parts: string[] = [];
    for (const name of ["ipb_member_id", "ipb_pass_hash", "igneous"]) {
      if (c[name]) parts.push(`${name}=${c[name]}`);
    }
    parts.push("nw=1"); // bypasses the "Offensive For Everyone" content warning site-wide
    return parts.join("; ");
  }

  /** Throw a clear error when the cookies needed for account features (favorites) aren't set. */
  private requireAuth(): void {
    const c = this.parsedCookies();
    if (!c.ipb_member_id || !c.ipb_pass_hash) {
      throw new Error(
        "favorites require your e-hentai session cookies — on a logged-in browser open DevTools → " +
          "Application → Cookies and paste ipb_member_id and ipb_pass_hash into this bridge's settings",
      );
    }
  }

  // ── Lists ─────────────────────────────────────────────────────────────────

  getLists(): Promise<SeriesList[]> {
    // Both are standalone pages (neither is a home *section*), so `featured` is what tells a host
    // which one to open on: Popular. Home is the site's front page, still one selector tap away.
    return Promise.resolve([
      { id: "popular", name: "Popular", layout: "grid", featured: true, page: true },
      { id: "home", name: "Home", layout: "grid", page: true },
    ]);
  }

  async getListItems(listId: string, req: ListRequest = {}): Promise<PagedResults<SeriesEntry>> {
    if (listId === "home") {
      return this.fetchListing(this.seekUrl(req.cursor) ?? `${this.base()}/`);
    }
    if (listId === "popular") {
      // /popular is a single snapshot page with no next link — never paginated.
      return this.fetchListing(`${this.base()}/popular`, false);
    }
    throw new Error(`Unknown list: ${listId}`);
  }

  /**
   * Read the seek URL out of a cursor. E-hentai paginates by `?next=GID`, not by page number, so the
   * cursor carries the whole next-page URL the previous response linked to. That URL is
   * self-describing — filters and query included — which is why resuming a search needs no
   * bookkeeping on this side. An absent or unusable cursor means "start over", as everywhere else.
   */
  private seekUrl(cursor: string | undefined): string | undefined {
    const url = decodeCursor<{ url?: unknown }>(cursor)?.url;
    // Only ever follow a cursor back to the site this bridge is configured for.
    return typeof url === "string" && url.startsWith(this.base()) ? url : undefined;
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async getSearchResults(req: SearchRequest): Promise<PagedResults<SeriesEntry>> {
    // A cursor already encodes the full seek URL, query params and all, so there is nothing to
    // rebuild when resuming — hand it straight back to the site.
    const seek = this.seekUrl(req.cursor);
    if (seek) return this.fetchListing(seek);

    const params = new URLSearchParams();
    const parts: string[] = [];

    if (req.text.trim()) parts.push(req.text.trim());

    // Language → search-syntax tags (e.g. "language:english")
    for (const lang of ((req.filters?.find((f) => f.key === "language")?.value ?? []) as string[])) {
      parts.push(`language:${lang}`);
    }

    // Category multiselect → exclusion bitmask (f_cats = all ^ selected)
    const cats = (req.filters?.find((f) => f.key === "category")?.value ?? []) as string[];
    if (cats.length > 0) {
      const included = cats.reduce((acc, c) => acc | (CAT_BITS[c] ?? 0), 0);
      params.set("f_cats", String(ALL_CATS_MASK ^ included));
    }

    if (parts.length) params.set("f_search", parts.join(" "));

    // Minimum rating → advanced-search star floor (f_srdd takes 2–5; "0"/absent = any).
    // E-hentai gallery search has no rating/favorite *sort* (that's Toplists-only), so this
    // star floor is how the site surfaces higher-quality results for a query.
    const minRating = (req.filters?.find((f) => f.key === "minRating")?.value ?? "") as string;
    if (minRating && minRating !== "0") {
      params.set("advsearch", "1");
      params.set("f_srdd", minRating);
    }

    return this.fetchListing(`${this.base()}/?${params.toString()}`);
  }

  private async fetchListing(url: string, paginated = true): Promise<PagedResults<SeriesEntry>> {
    return this.listingFromHtml(await this.getHtml(url), paginated);
  }

  /** Turn a gallery-listing page's HTML into enriched results plus the seek cursor for the next page. */
  private async listingFromHtml(html: string, paginated = true): Promise<PagedResults<SeriesEntry>> {
    const pairs = extractGalleryPairs(html);
    // The `?next=GID` seek link is the only trustworthy "is there more" answer: the last page
    // routinely has a full 25 items, so a per-page count would claim another page exists. Deriving
    // the cursor straight from the link means the two can't disagree — no link, no cursor, walk over.
    const nextUrl = paginated ? extractNextUrl(html) : undefined;
    const nextCursor = nextUrl ? encodeCursor({ url: this.resolveUrl(nextUrl) }) : undefined;

    if (pairs.length === 0) return { items: [] };

    // gdata API accepts at most 25 pairs per request; chunk accordingly.
    const GDATA_BATCH = 25;
    const metaById = new Map<string, GMetadata>();
    for (let i = 0; i < pairs.length; i += GDATA_BATCH) {
      const chunk = pairs.slice(i, i + GDATA_BATCH);
      const resp = await this.postJson<GDataResponse>(EH_API, {
        method: "gdata",
        gidlist: chunk.map(({ gid, token }) => [gid, token]),
        namespace: 1,
      });
      for (const m of resp.gmetadata ?? []) {
        metaById.set(`${m.gid}:${m.token}`, m);
      }
    }

    const items: SeriesEntry[] = pairs.map(({ gid, token }): SeriesEntry => {
      const id = `${gid}:${token}`;
      const meta = metaById.get(id);
      // Expunged/superseded galleries (struck-through date in favorites) still carry a valid title and
      // thumbnail and remain viewable — only a genuine API error means there's no data to show.
      if (!meta || meta.error) return { id, title: id };
      const entry: SeriesEntry = { id, title: meta.title ?? id };
      if (meta.thumb) entry.thumbnailUrl = normalizeThumbUrl(meta.thumb);
      const badges = cardBadges(meta);
      if (badges.length) entry.badges = badges;
      return entry;
    });

    return { items, nextCursor };
  }

  // ── Filters / sort ────────────────────────────────────────────────────────

  getFilters(): Promise<Filter[]> {
    return Promise.resolve([
      {
        type: "multiselect",
        key: "category",
        label: "Category",
        defaultAll: true,
        options: [
          { value: "doujinshi", label: "Doujinshi" },
          { value: "manga", label: "Manga" },
          { value: "artist-cg", label: "Artist CG" },
          { value: "game-cg", label: "Game CG" },
          { value: "western", label: "Western" },
          { value: "non-h", label: "Non-H" },
          { value: "image-set", label: "Image Set" },
          { value: "cosplay", label: "Cosplay" },
          { value: "asian-porn", label: "Asian Porn" },
          { value: "misc", label: "Misc" },
        ],
      },
      {
        type: "multiselect",
        key: "language",
        label: "Language",
        options: [
          { value: "english", label: "English" },
          { value: "japanese", label: "Japanese" },
          { value: "chinese", label: "Chinese" },
          { value: "korean", label: "Korean" },
          { value: "spanish", label: "Spanish" },
          { value: "french", label: "French" },
          { value: "german", label: "German" },
        ],
      },
      {
        // E-hentai's gallery search can only order by posted date, so "Top Rated" can't be a sort.
        // Its advanced search does expose a minimum-rating floor (f_srdd), which is the closest
        // working equivalent — surface that as a filter instead.
        type: "select",
        key: "minRating",
        label: "Minimum Rating",
        options: [
          { value: "0", label: "Any" },
          { value: "2", label: "2+ Stars" },
          { value: "3", label: "3+ Stars" },
          { value: "4", label: "4+ Stars" },
          { value: "5", label: "5 Stars" },
        ],
      },
    ]);
  }

  // ── Favorites ───────────────────────────────────────────────────────────────
  // Backed by the e-hentai account's own favorites, so these require the user's session cookies:
  // requireAuth() throws a clear error if they're unset — plain e-hentai browsing stays anonymous. All
  // categories are merged into one bucket (favcat=all); new favorites land in the user's chosen default
  // slot. URLs derive from base(), so ExHentai works automatically.

  async getFavorites(req: PagedRequest = {}): Promise<PagedResults<SeriesEntry>> {
    this.requireAuth();
    const url = this.seekUrl(req.cursor) ?? `${this.base()}/favorites.php?favcat=all`;

    const html = await this.getHtml(url);
    if (isLoggedOut(html)) {
      throw new Error(
        "your e-hentai session has expired or is invalid — paste fresh cookies in this bridge's settings",
      );
    }

    return this.listingFromHtml(html);
  }

  async addFavorite(seriesId: string): Promise<void> {
    await this.modifyFavorite(seriesId, this.setting("favcat") ?? "0");
  }

  async removeFavorite(seriesId: string): Promise<void> {
    await this.modifyFavorite(seriesId, "favdel");
  }

  async isFavorite(seriesId: string): Promise<boolean> {
    this.requireAuth();
    const [gid, token] = parseId(seriesId);
    return isFavoritedFromPopup(await this.getHtml(this.favPopupUrl(gid, token)));
  }

  /** POST a favcat change to the addfav popup. `favcat` is "0".."9" to set a slot, "favdel" to remove. */
  private async modifyFavorite(seriesId: string, favcat: string): Promise<void> {
    this.requireAuth();
    const [gid, token] = parseId(seriesId);
    const res = await this.request({
      url: this.favPopupUrl(gid, token),
      method: "POST",
      headers: {
        ...this.headers(true),
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: `${this.base()}/g/${gid}/${token}/`,
      },
      body: new URLSearchParams({ favcat, favnote: "", apply: "Apply Changes", update: "1" }).toString(),
    });
    if (res.status >= 400) throw new Error(`favorite update failed: HTTP ${res.status}`);
  }

  private favPopupUrl(gid: number, token: string): string {
    return `${this.base()}/gallerypopups.php?gid=${gid}&t=${token}&act=addfav`;
  }

  // ── Series detail ─────────────────────────────────────────────────────────

  async getSeriesDetails(seriesId: string): Promise<SeriesInfo> {
    const [gid, token] = parseId(seriesId);
    const resp = await this.postJson<GDataResponse>(EH_API, {
      method: "gdata",
      gidlist: [[gid, token]],
      namespace: 1,
    });
    const meta = resp.gmetadata?.[0];
    if (meta?.error) throw new Error(`E-Hentai API error: ${meta.error}`);

    const info: SeriesInfo = {
      id: seriesId,
      title: meta?.title ?? seriesId,
      status: "completed",
    };

    if (meta?.thumb) info.thumbnailUrl = fullSizeThumbUrl(meta.thumb);
    // The gallery category (Doujinshi / Manga / …) is its type, shown as the Type cell rather than a
    // lone genre chip (it's also painted as a card badge in list/search views).
    if (meta?.category) info.type = meta.category;
    if (meta?.title_jpn) info.description = meta.title_jpn;

    if (meta?.tags?.length) {
      const byNs = groupTagsByNs(meta.tags);
      const tagGroups: TagGroup[] = [];

      // Author: prefer artist namespace, fall back to group
      const credits = byNs.get("artist") ?? byNs.get("group");
      if (credits?.length) {
        info.author = credits.join(", ");
        // Per-credit chips; names (not ids) are what the author filter matches on this site.
        info.authors = credits.map((name) => ({ name }));
      }

      // Languages via the dedicated field
      const langs = byNs.get("language");
      if (langs?.length) info.languages = langs;

      // Build tag groups for all namespaces
      for (const [ns, tags] of byNs) {
        if (ns === "language") continue; // surfaced via info.languages already
        const label = NS_LABELS[ns] ?? (ns[0]!.toUpperCase() + ns.slice(1));
        const kind = TAG_KINDS[ns];
        const group: TagGroup = { label, tags, tagQueries: tags.map((v) => tagSearchToken(ns, v)) };
        if (kind) group.kind = kind;
        tagGroups.push(group);
      }

      if (tagGroups.length) info.tagGroups = tagGroups;
    }

    const pageCount = meta?.filecount ? parseInt(meta.filecount, 10) : NaN;
    if (pageCount > 0) info.pageCount = pageCount;

    return info;
  }

  // ── Direct pages ──────────────────────────────────────────────────────────

  /**
   * Fetch page list via MPV (1 request, requires auth) or viewer scraping fallback.
   *
   * MPV path: all hashes known upfront → proxy URLs embed the hash directly.
   * Fallback path: only the first viewer page is fetched to get the total count.
   *   Proxy URLs embed "_" as the hash sentinel; resolvePage resolves the real
   *   hash on demand using a per-viewer-page cache.
   */
  async getSeriesPages(seriesId: string): Promise<Page[]> {
    const [gid, token] = parseId(seriesId);
    const encSeriesId = encodeURIComponent(seriesId);
    // Self-referential proxy path must use this bridge's *actual* id (publisher-scoped, e.g.
    // "pos5drow.e-hentai") — the host resolves the page-image route by the exact id segment, so a
    // hardcoded "e-hentai" 404s. Derive it from info.id so a future rename can't silently break it.
    const encId = encodeURIComponent(this.info.id);

    // Try MPV first — 1 request, but requires a logged-in session.
    console.log(`[e-hentai] getSeriesPages ${seriesId}: trying MPV`);
    const mpvHtml = await this.getHtml(`${this.base()}/mpv/${gid}/${token}/`);
    if (!mpvHtml.includes("eeenope")) {
      // dotAll flag handles imagelist JSON that may span multiple lines
      const match = mpvHtml.match(/var imagelist\s*=\s*(\[[\s\S]+?\]);/);
      if (match) {
        const imagelist = JSON.parse(match[1]) as Array<{ k: string; t?: string }>;
        if (imagelist.length > 0) {
          console.log(`[e-hentai] getSeriesPages ${seriesId}: MPV OK, ${imagelist.length} pages`);
          return imagelist.map((entry, i) => {
            const page: Page = {
              index: i,
              imageUrl: `/bridges/${encId}/series/${encSeriesId}/page-image/${entry.k}/${gid}-${i + 1}`,
            };
            if (typeof entry.t === "string" && entry.t.startsWith("http")) {
              page.thumbnail = { kind: "image", url: normalizeThumbUrl(entry.t) };
            }
            return page;
          });
        }
      }
    }

    // Fallback: fetch only the first viewer page to get total count + first batch of thumbnails.
    // Hashes for later pages are resolved lazily in resolvePage as the reader scrolls.
    console.log(`[e-hentai] getSeriesPages ${seriesId}: MPV unavailable, falling back to viewer scraping`);
    const firstHtml = await this.getHtml(`${this.base()}/g/${gid}/${token}/?p=0`);
    const filecount = extractFilecount(firstHtml);
    if (filecount === 0) {
      console.error(`[e-hentai] getSeriesPages ${seriesId}: could not extract page count from viewer HTML`);
      throw new Error("Gallery not found or expunged.");
    }

    // Pre-populate cache for the first viewer page and extract sprite thumbnails for pages 1–N.
    const firstEntries = extractPageHashes(firstHtml);
    const firstThumbs = extractViewerThumbnails(firstHtml);
    this.hashCache.set(`${gid}:0`, new Map(firstEntries.map((e) => [e.pageNum, e.hash])));
    this.thumbCache.set(`${gid}:0`, firstThumbs);
    console.log(`[e-hentai] getSeriesPages ${seriesId}: viewer fallback OK, ${filecount} pages (${firstEntries.length} hashes, ${firstThumbs.size} thumbs for first viewer page)`);

    return Array.from({ length: filecount }, (_, i) => {
      const thumb = firstThumbs.get(i + 1);
      const page: Page = {
        index: i,
        imageUrl: `/bridges/${encId}/series/${encSeriesId}/page-image/_/${gid}-${i + 1}`,
      };
      if (thumb) page.thumbnail = spriteThumb(thumb);
      return page;
    });
  }

  /** Fetch and cache the hash map for a single viewer page (deduplicates concurrent calls).
   *  Also populates thumbCache as a side-effect so getPageThumbnail avoids a second fetch. */
  private getViewerPageHashes(gid: number, token: string, viewerPage: number): Promise<Map<number, string>> {
    const key = `${gid}:${viewerPage}`;
    const cached = this.hashCache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.hashCachePending.get(key);
    if (pending) return pending;
    const promise = this.getHtml(`${this.base()}/g/${gid}/${token}/?p=${viewerPage}`).then((html) => {
      const map = new Map(extractPageHashes(html).map((e) => [e.pageNum, e.hash]));
      this.hashCache.set(key, map);
      this.thumbCache.set(key, extractViewerThumbnails(html));
      this.hashCachePending.delete(key);
      return map;
    });
    this.hashCachePending.set(key, promise);
    return promise;
  }

  /** Return the thumbnail descriptor for a single page by 0-based index. */
  async getPageThumbnail(seriesId: string, pageIndex: number): Promise<PageThumbnail> {
    const [gid, token] = parseId(seriesId);
    const viewerPage = Math.floor(pageIndex / VIEWER_PAGE_SIZE);
    const key = `${gid}:${viewerPage}`;
    let thumbs = this.thumbCache.get(key);
    if (!thumbs) {
      await this.getViewerPageHashes(gid, token, viewerPage);
      thumbs = this.thumbCache.get(key) ?? new Map();
    }
    const thumb = thumbs.get(pageIndex + 1); // pageNum is 1-based
    if (!thumb) throw new Error(`No thumbnail data for page ${pageIndex + 1}`);
    return spriteThumb(thumb);
  }

  /** Resolve the CDN URL for a single page on demand (called by the host-server proxy route). */
  async resolvePage(seriesId: string, hash: string, gidRef: string): Promise<string> {
    // "_" sentinel: hash wasn't known at getSeriesPages time — look it up lazily.
    if (hash === "_") {
      const [gid, token] = parseId(seriesId);
      const pageNum = parseInt(gidRef.split("-")[1]!, 10);
      const viewerPage = Math.floor((pageNum - 1) / VIEWER_PAGE_SIZE);
      console.log(`[e-hentai] resolvePage ${gidRef}: fetching hash from viewer page ${viewerPage}`);
      const map = await this.getViewerPageHashes(gid, token, viewerPage);
      const resolved = map.get(pageNum);
      if (!resolved) {
        console.error(`[e-hentai] resolvePage ${gidRef}: hash not found in viewer page ${viewerPage} (${map.size} entries)`);
        throw new Error(`Hash not found for page ${pageNum}`);
      }
      hash = resolved;
    }

    const pageUrl = `${this.base()}/s/${hash}/${gidRef}`;
    const pageHtml = await this.getHtml(pageUrl);
    const imageUrl = extractImageUrl(pageHtml);
    if (imageUrl) return imageUrl;
    // Image URL missing — CDN assignment may have expired; retry with nl token if present
    const nlMatch = pageHtml.match(/return nl\('([^']+)'\)/);
    if (nlMatch) {
      console.log(`[e-hentai] resolvePage ${gidRef}: image URL missing, retrying with nl token`);
      const retryHtml = await this.getHtml(`${pageUrl}?nl=${encodeURIComponent(nlMatch[1]!)}`);
      const retryUrl = extractImageUrl(retryHtml);
      if (retryUrl) return retryUrl;
    }
    console.error(`[e-hentai] resolvePage ${gidRef}: could not extract image URL`);
    throw new Error(`Could not extract image URL for page ${gidRef}`);
  }
}

/** "2875621:5e748ef5c5" → [2875621, "5e748ef5c5"] */
function parseId(seriesId: string): [number, string] {
  const colon = seriesId.indexOf(":");
  return [parseInt(seriesId.slice(0, colon), 10), seriesId.slice(colon + 1)];
}

export default defineBridge((host) => new EHentaiBridge(host));
