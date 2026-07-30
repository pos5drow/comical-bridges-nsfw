/**
 * nhentai bridge (v2 API) — https://nhentai.net
 *
 * Uses the official v2 JSON API. Auth is an API key the user creates at
 * nhentai.net › Account › API Keys — no cookies, no CloudFlare wrestling.
 * The key is optional for browsing (public endpoints work without it); it
 * unlocks higher rate limits and enables favorites.
 *
 * Galleries have no chapter structure, so this bridge uses the "direct"
 * capability: `getSeriesPages` returns a flat page list.
 *
 * NOTE: The v2 list endpoints (GalleryListItem) and detail endpoint
 * (GalleryDetail) use different schemas. List items carry flat title strings
 * and a bare thumbnail path; the detail carries a title object and full page
 * metadata. CDN base URLs come from /api/v2/cdn and are cached for the life
 * of the bridge instance.
 */
import {
  BridgeBase,
  type BridgeInfo,
  type Filter,
  type ListRequest,
  type Page,
  type PagedRequest,
  type PagedResults,
  type RelatedSeriesGroup,
  type SearchRequest,
  type CardBadge,
  type SeriesEntry,
  type SeriesInfo,
  type SeriesList,
  type SortOption,
  type InferSettings,
  type SettingDescriptor,
  type Tag,
  type TagGroup,
  abbreviateLanguage,
  defineBridge,
  defineSettings,
  nextPageCursor,
  pageFromCursor,
  parseFilterIncludeExclude,
} from "@comical/sdk";

const BASE = "https://nhentai.net/api/v2";
const IMG_FALLBACK = "https://i1.nhentai.net";
const THUMB_FALLBACK = "https://t1.nhentai.net";

const PER_PAGE = 25;

/**
 * Placeholder title for an entry redacted by the user's tag exclusions. Carries no real name; the
 * host renders its own blank placeholder for `excluded` entries, and an unaware host degrades to a
 * coverless "Hidden" card. Never the actual gallery title.
 */
const REDACTED_TITLE = "Hidden";

const SETTINGS = defineSettings([
  {
    type: "string",
    key: "apiKey",
    label: "API key",
    description:
      "Optional for browsing — required for favorites. Create one at nhentai.net › Account › API Keys.",
    secret: true,
  },
]);
type Settings = InferSettings<typeof SETTINGS>;

// ── DTOs ──────────────────────────────────────────────────────────────────────
// List items and detail use different shapes in the v2 API.

/** Lightweight gallery as returned by list/search endpoints. */
interface GalleryListItem {
  id: number;
  media_id: string;
  /** Flat string — NOT a nested object like the detail endpoint. */
  english_title?: string;
  japanese_title?: string;
  /** Relative CDN path, e.g. "galleries/3979254/thumb.webp". Prefix with thumb server. */
  thumbnail?: string;
  num_pages?: number;
  tag_ids?: number[];
}

/** Full gallery from the detail endpoint. */
interface GalleryTitle {
  english?: string;
  japanese?: string;
  pretty?: string;
}
interface PathDim {
  path: string;
  width?: number;
  height?: number;
}
interface PageItem {
  number: number;
  /** Relative CDN path, e.g. "galleries/3979254/1.webp". Prefix with image server. */
  path: string;
  width?: number;
  height?: number;
  /**
   * Relative thumbnail path, prefixed with the thumb server. The API spells this out because
   * nhentai's thumbnails inconsistently carry a double extension (e.g. `2t.webp.webp`), so it can't
   * be reliably derived from `path`. ~400px `…t.webp` preview.
   */
  thumbnail?: string;
  thumbnail_width?: number;
  thumbnail_height?: number;
}
interface GalleryTag {
  id: number;
  type: string; // tag | language | artist | group | parody | category | character
  name: string;
}
interface GalleryDetail {
  id: number;
  media_id: string;
  title: GalleryTitle;
  cover?: PathDim;
  thumbnail?: PathDim;
  pages?: PageItem[];
  tags?: GalleryTag[];
  num_pages?: number;
}

interface PaginatedGalleries {
  result?: GalleryListItem[];
  num_pages?: number;
}

interface CdnConfigResponse {
  image_servers?: string[];
  thumb_servers?: string[];
}

interface TagDto {
  id: number;
  type: string;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * nhentai's permanent tag ids for the three languages it carries, used to put a language badge on a
 * card. List/search payloads only ship a flat `tag_ids` array (no tag names), so this tiny constant
 * map reads the language straight from data already in hand — no name lookup, no extra request. The
 * "translated" modifier tag is intentionally excluded so the badge shows the actual language.
 */
const LANGUAGE_TAG_IDS: Record<number, string> = {
  12227: "English",
  6346: "Japanese",
  29963: "Chinese",
};

/**
 * Language badge for a card from its inline tag ids, anchored bottom-right and shown as a terse
 * abbreviation ("EN", "JP"); none when no language is tagged.
 */
function languageBadges(tagIds: number[] | undefined): CardBadge[] {
  for (const id of tagIds ?? []) {
    const lang = LANGUAGE_TAG_IDS[id];
    if (lang) return [{ text: abbreviateLanguage(lang), position: "bottom-right", tone: "info" }];
  }
  return [];
}

/** Prefix a relative CDN path with its server origin. */
function cdnUrl(relativePath: string, server: string): string {
  return `${server}/${relativePath}`;
}

/**
 * Fallback derivation of a page's thumbnail path from its full-page path — insert the `t` suffix
 * before the extension ("galleries/123/1.webp" → "galleries/123/1t.webp"). Only used when the API
 * omits the explicit `thumbnail` field; the API value is preferred because nhentai inconsistently
 * adds a double extension (`2t.webp.webp`) that this transform can't reproduce.
 */
function thumbPath(pagePath: string): string {
  return pagePath.replace(/\.(\w+)$/, "t.$1");
}

function listItemTitle(item: GalleryListItem): string {
  return item.english_title ?? item.japanese_title ?? String(item.id);
}

// ── Lists ─────────────────────────────────────────────────────────────────────

interface ListDef extends SeriesList {
  path: string;
  paginated: boolean;
}

const LISTS: ReadonlyArray<ListDef> = [
  // nhentai's homepage "Popular Now" feed. NOTE: distinct from the `popular-today` *sort* option
  // below (search?sort=popular-today) — `galleries/popular` is the live homepage rail and matches
  // the site's "Popular Now" section exactly.
  { id: "popular-now", name: "Popular Now", layout: "grid", featured: true, path: "galleries/popular", paginated: false },
  { id: "new", name: "New Arrivals", layout: "grid", featured: true, path: "galleries", paginated: true },
];

// ── Bridge ────────────────────────────────────────────────────────────────────

class NhentaiBridge extends BridgeBase<Settings> {
  readonly info: BridgeInfo = {
    id: "pos5drow.nhentai",
    name: "nhentai",
    version: "0.2.0",
    contractVersion: "2.0.0",
    languages: ["multi"],
    nsfw: true,
    capabilities: ["lists", "search", "filters", "sort", "settings", "favorites", "direct", "exclude-tags", "resolve-tags", "related-series"],
    iconUrl: "https://nhentai.net/favicon.png",
    rateLimit: { maxConcurrent: 1, minIntervalMs: 700 },
  };

  private cdnImageServer: string | undefined;
  private cdnThumbServer: string | undefined;
  private cdnFetched = false;
  private tagNames = new Map<string, string>(); // tagId → name
  private lastDetail: { id: string; data: GalleryDetail } | undefined;

  getSettings(): SettingDescriptor[] {
    return [...SETTINGS];
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    };
    const key = this.setting("apiKey");
    if (key) h["Authorization"] = `Key ${key}`;
    return h;
  }

  private getJson<T>(url: string): Promise<T> {
    return this.fetchJson<T>(url, this.headers());
  }

  private async postJson<T>(url: string, body: unknown): Promise<T> {
    const res = await this.request({
      url,
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return JSON.parse(res.body) as T;
  }

  private async deleteReq(url: string): Promise<void> {
    const res = await this.request({ url, method: "DELETE", headers: this.headers() });
    if (res.status >= 400) throw new Error(`${res.status} ${res.statusText}`);
  }

  // ── CDN ───────────────────────────────────────────────────────────────────

  private async ensureCdn(): Promise<void> {
    if (this.cdnFetched) return;
    this.cdnFetched = true;
    try {
      const cfg = await this.getJson<CdnConfigResponse>(`${BASE}/cdn`);
      this.cdnImageServer = cfg.image_servers?.[0];
      this.cdnThumbServer = cfg.thumb_servers?.[0];
    } catch { /* fall back to hardcoded servers below */ }
  }

  private async imageServer(): Promise<string> {
    await this.ensureCdn();
    return this.cdnImageServer ?? IMG_FALLBACK;
  }

  private async thumbServer(): Promise<string> {
    await this.ensureCdn();
    return this.cdnThumbServer ?? THUMB_FALLBACK;
  }

  // ── Gallery detail (single-slot cache) ───────────────────────────────────

  // TODO(explore): the detail endpoint takes a composite `?include=` param —
  // `GET /galleries/{id}?include=comments,related,favorite,suggestions` — that folds the related
  // rail, favorite status, comments and suggestions into this one response (it populates the
  // detail's `related` / `is_favorited` fields). We currently fetch those as separate calls
  // (`getRelatedSeries` → /related, `isFavorite` → /favorite). Consolidating could cut those extra
  // round-trips, but mind what's on the detail critical path: related/favorite are intentionally
  // deferred off the initial detail fetch (see getSeriesDetails / the app's lazy queries), so only
  // add includes that are worth paying for up front, or gate them behind a param.
  private async fetchDetail(seriesId: string): Promise<GalleryDetail> {
    if (this.lastDetail?.id === seriesId) return this.lastDetail.data;
    const data = await this.getJson<GalleryDetail>(`${BASE}/galleries/${encodeURIComponent(seriesId)}`);
    this.lastDetail = { id: seriesId, data };
    return data;
  }

  /**
   * nhentai's algorithmic "More Like This" rail: `GET /galleries/{id}/related` returns the same
   * `{ result: GalleryListItem[] }` shape as the list endpoints (typically 5 galleries), so the
   * items reuse the standard `toEntry` pipeline. Best-effort — any failure yields an empty rail
   * rather than breaking the detail page.
   */
  private async fetchRelated(seriesId: string): Promise<GalleryListItem[]> {
    try {
      const data = await this.getJson<PaginatedGalleries>(
        `${BASE}/galleries/${encodeURIComponent(seriesId)}/related`,
      );
      return data.result ?? [];
    } catch {
      return [];
    }
  }

  // ── Convert list item → SeriesEntry ──────────────────────────────────────

  private toEntry(item: GalleryListItem, thumb: string, excluded?: Set<string>): SeriesEntry {
    // Redact items carrying an excluded tag (capability "exclude-tags"). The inline `tag_ids` ride
    // along in every list/search payload, so this match costs no extra request. We keep the slot
    // but strip the title and thumbnail: the host shows a blank placeholder and never fetches a cover.
    if (excluded?.size && (item.tag_ids ?? []).some((t) => excluded.has(String(t)))) {
      return { id: String(item.id), title: REDACTED_TITLE, excluded: true };
    }
    const entry: SeriesEntry = {
      id: String(item.id),
      title: listItemTitle(item),
    };
    if (item.thumbnail) entry.thumbnailUrl = cdnUrl(item.thumbnail, thumb);
    const badges = languageBadges(item.tag_ids);
    if (badges.length) entry.badges = badges;
    return entry;
  }

  private async listToEntries(items: GalleryListItem[], excluded?: Set<string>): Promise<SeriesEntry[]> {
    const thumb = await this.thumbServer();
    return items.map((item) => this.toEntry(item, thumb, excluded));
  }

  /** Build the excluded-tag-id set from the request (numeric tag ids, as `getTags()` returns). */
  private excludedSet(req: { excludedTags?: string[] | undefined }): Set<string> | undefined {
    const ids = req.excludedTags;
    if (!ids?.length) return undefined;
    const set = new Set(ids.map((s) => String(s).trim()).filter(Boolean));
    return set.size ? set : undefined;
  }

  // ── Tags ─────────────────────────────────────────────────────────────────

  async getTags(query = ""): Promise<Tag[]> {
    try {
      const results = await this.postJson<TagDto[]>(`${BASE}/tags/search`, {
        query: query.trim(),
        type: "tag",
      });
      return (results ?? []).slice(0, 50).map((r) => {
        this.tagNames.set(String(r.id), r.name);
        return { id: String(r.id), label: r.name };
      });
    } catch {
      return [];
    }
  }

  /**
   * Reverse lookup, the inverse of `getTags`'s name search: resolve bare tag ids back to names via
   * nhentai's `tags/ids` batch endpoint (the host uses it to put names on persisted exclusions). Only
   * numeric ids are queryable; unresolved ids are silently omitted, and any failure yields nothing
   * (the host then shows the id). Resolved names seed `tagNames` for redaction reuse.
   */
  async resolveTags(ids: string[]): Promise<Tag[]> {
    const numeric = ids
      .map((id) => id.trim())
      .filter((s) => s.length > 0 && Number.isInteger(Number(s)));
    if (numeric.length === 0) return [];
    try {
      // GET /api/v2/tags/ids?ids=19440,32341 → bare TagDto[] (id/type/name/…).
      const results = await this.getJson<TagDto[]>(`${BASE}/tags/ids?ids=${numeric.join(",")}`);
      return (results ?? []).map((r) => {
        this.tagNames.set(String(r.id), r.name);
        return { id: String(r.id), label: r.name };
      });
    } catch {
      return [];
    }
  }

  // ── Filters / sort ────────────────────────────────────────────────────────

  getFilters(): Promise<Filter[]> {
    return Promise.resolve([
      { type: "tag-multiselect", key: "tag", label: "Tag", excludable: true },
      {
        type: "multiselect",
        key: "language",
        label: "Language",
        excludable: true,
        options: [
          { value: "english", label: "English" },
          { value: "japanese", label: "Japanese" },
          { value: "chinese", label: "Chinese" },
          { value: "korean", label: "Korean" },
          { value: "spanish", label: "Spanish" },
        ],
      },
      {
        type: "multiselect",
        key: "category",
        label: "Category",
        excludable: true,
        options: [
          { value: "doujinshi", label: "Doujinshi" },
          { value: "manga", label: "Manga" },
          { value: "artistcg", label: "Artist CG" },
          { value: "gamecg", label: "Game CG" },
          { value: "western", label: "Western" },
        ],
      },
      { type: "text", key: "author", label: "Artist" },
    ]);
  }

  getSortOptions(): Promise<SortOption[]> {
    return Promise.resolve([
      { key: "date", label: "New Arrivals", directionless: true },
      { key: "popular", label: "All-Time Popular", directionless: true },
      { key: "popular-today", label: "Popular Today", directionless: true },
      { key: "popular-week", label: "Popular This Week", directionless: true },
      { key: "popular-month", label: "Popular This Month", directionless: true },
    ]);
  }

  // ── Lists ─────────────────────────────────────────────────────────────────

  getLists(): Promise<SeriesList[]> {
    return Promise.resolve(LISTS.map(({ path: _p, paginated: _q, ...list }) => list));
  }

  async getListItems(listId: string, req: ListRequest = {}): Promise<PagedResults<SeriesEntry>> {
    const list = LISTS.find((l) => l.id === listId);
    if (!list) throw new Error(`unknown list: ${listId}`);
    const excluded = this.excludedSet(req);

    if (!list.paginated) {
      const raw = await this.getJson<GalleryListItem[] | PaginatedGalleries>(`${BASE}/${list.path}`);
      const rawItems = Array.isArray(raw) ? raw : (raw.result ?? []);
      // A one-shot endpoint — the whole list arrives at once, so there is no next cursor.
      return { items: await this.listToEntries(rawItems, excluded) };
    }

    // nhentai's API is page-numbered and reports num_pages, so the cursor is just a page number.
    const page = pageFromCursor(req.cursor);
    const data = await this.getJson<PaginatedGalleries>(
      `${BASE}/${list.path}?page=${page}&per_page=${PER_PAGE}`,
    );
    return {
      items: await this.listToEntries(data.result ?? [], excluded),
      nextCursor: nextPageCursor(page, page < (data.num_pages ?? 0)),
    };
  }

  // ── Search ────────────────────────────────────────────────────────────────

  async getSearchResults(req: SearchRequest): Promise<PagedResults<SeriesEntry>> {
    const page = pageFromCursor(req.cursor);
    const sort = req.sort?.key ?? "date";
    const excluded = this.excludedSet(req);
    const parts: string[] = [];
    if (req.text.trim()) parts.push(req.text.trim());

    for (const f of req.filters ?? []) {
      if (f.key === "language") {
        const { include, exclude } = parseFilterIncludeExclude(f.value);
        for (const lang of include) parts.push(`language:${lang}`);
        for (const lang of exclude) parts.push(`-language:${lang}`);
      } else if (f.key === "category") {
        const { include, exclude } = parseFilterIncludeExclude(f.value);
        for (const cat of include) parts.push(`category:${cat}`);
        for (const cat of exclude) parts.push(`-category:${cat}`);
      } else if (f.key === "tag") {
        const { include, exclude } = parseFilterIncludeExclude(f.value);
        for (const id of include) {
          const name = this.tagNames.get(id);
          if (name) parts.push(`tag:"${name}"`);
        }
        for (const id of exclude) {
          const name = this.tagNames.get(id);
          if (name) parts.push(`-tag:"${name}"`);
        }
      } else if (f.key === "author" && typeof f.value === "string" && f.value.trim()) {
        parts.push(`artist:"${f.value.trim()}"`);
      }
    }

    // Empty date-sorted browse: use the list endpoint directly.
    if (!parts.length && sort === "date") {
      const data = await this.getJson<PaginatedGalleries>(
        `${BASE}/galleries?page=${page}&per_page=${PER_PAGE}`,
      );
      return {
        items: await this.listToEntries(data.result ?? [], excluded),
        nextCursor: nextPageCursor(page, page < (data.num_pages ?? 0)),
      };
    }

    const q = encodeURIComponent(parts.join(" ") || "*");
    const data = await this.getJson<PaginatedGalleries>(
      `${BASE}/search?query=${q}&sort=${encodeURIComponent(sort)}&page=${page}`,
    );
    return {
      items: await this.listToEntries(data.result ?? [], excluded),
      nextCursor: nextPageCursor(page, page < (data.num_pages ?? 0)),
    };
  }

  // ── Series detail ─────────────────────────────────────────────────────────

  async getSeriesDetails(seriesId: string): Promise<SeriesInfo> {
    // Only fetch the gallery detail on the critical path. CDN config is already warm from list/search
    // calls (thumbServer() is called in listToEntries), so we can read the cached value directly
    // without acquiring a rate-limiter slot. Related series are loaded lazily via getRelatedSeries.
    const g = await this.fetchDetail(seriesId);
    const thumb = this.cdnThumbServer ?? THUMB_FALLBACK;

    const info: SeriesInfo = {
      id: seriesId,
      title: g.title.english ?? g.title.pretty ?? g.title.japanese ?? seriesId,
      status: "completed",
    };

    const coverPath = g.cover?.path ?? g.thumbnail?.path;
    if (coverPath) info.thumbnailUrl = cdnUrl(coverPath, thumb);

    const byType = new Map<string, string[]>();
    const idByType = new Map<string, string[]>();
    for (const tag of g.tags ?? []) {
      if (!byType.has(tag.type)) { byType.set(tag.type, []); idByType.set(tag.type, []); }
      byType.get(tag.type)!.push(tag.name);
      idByType.get(tag.type)!.push(String(tag.id));
      this.tagNames.set(String(tag.id), tag.name);
    }

    const artists = byType.get("artist") ?? [];
    const groups = byType.get("group") ?? [];
    // Authors are artists ONLY. A group is a distinct credit type on nhentai, so never fall back
    // to it here — otherwise a group-only gallery shows the group as its "author", and tapping that
    // author searches `artist:"<group>"` (see getSearchResults), which is the wrong axis and matches
    // nothing. Groups get their own searchable chip group below instead.
    if (artists.length) {
      info.author = artists.join(", ");
      // Per-credit chips for the host. No id: the "author" filter matches artist *names*
      // (see getSearchResults → `artist:"…"`), so a name is the precise, filterable value here.
      info.authors = artists.map((name) => ({ name }));
    }

    // nhentai's "category" (Doujinshi / Manga / Artist CG / …) is the gallery's type, not a genre —
    // surface it as the Type cell so it doesn't render as a lone genre chip.
    const categories = byType.get("category");
    if (categories?.length) info.type = categories[0];

    const tagGroups: TagGroup[] = [];

    const contentTags = byType.get("tag");
    const contentTagIds = idByType.get("tag");
    if (contentTags?.length) {
      const group: TagGroup = { label: "Tags", kind: "theme", tags: contentTags };
      if (contentTagIds?.every(Boolean)) group.tagIds = contentTagIds;
      tagGroups.push(group);
    }

    const characters = byType.get("character");
    if (characters?.length) tagGroups.push({ label: "Characters", tags: characters });

    const parodies = byType.get("parody");
    if (parodies?.length) tagGroups.push({ label: "Parodies", tags: parodies });

    // Groups are searchable as groups: nhentai's search box understands `group:"…"`, and
    // getSearchResults passes a free-text query straight through — so a `tagQueries` entry makes a
    // group chip run the right query (not a bare name that would match artists/tags/free text).
    if (groups.length) {
      tagGroups.push({ label: "Groups", tags: groups, tagQueries: groups.map((name) => `group:"${name}"`) });
    }

    const languages = byType.get("language");
    if (languages?.length) tagGroups.push({ label: "Languages", tags: languages });

    if (tagGroups.length) info.tagGroups = tagGroups;

    if (g.num_pages) info.pageCount = g.num_pages;

    return info;
  }

  // ── Related series (lazy, separate from getSeriesDetails) ─────────────────

  async getRelatedSeries(seriesId: string): Promise<RelatedSeriesGroup[]> {
    const related = await this.fetchRelated(seriesId);
    if (!related.length) return [];
    const series = await this.listToEntries(related);
    return [{ label: "More Like This", kind: "similar", series }];
  }

  // ── Direct pages ──────────────────────────────────────────────────────────

  async getSeriesPages(seriesId: string): Promise<Page[]> {
    const [g, imgSrv, thumbSrv] = await Promise.all([
      this.fetchDetail(seriesId),
      this.imageServer(),
      this.thumbServer(),
    ]);
    const referer = `https://nhentai.net/g/${seriesId}/`;
    return (g.pages ?? []).map((p): Page => ({
      index: p.number - 1,
      imageUrl: cdnUrl(p.path, imgSrv),
      // The page grid uses the API's `…t.webp` thumbnail (a crisp ~400px preview, ~24KB — the same one
      // the site's gallery grid loads), NOT the full image. Use the API-given filename: nhentai's
      // thumbnails inconsistently carry a double extension (`2t.webp.webp`), so deriving it from `path`
      // 404s ~half the pages, which is what made the grid look low-res.
      thumbnail: { kind: "image", url: cdnUrl(p.thumbnail ?? thumbPath(p.path), thumbSrv) },
      headers: { Referer: referer },
    }));
  }

  // ── Favorites ─────────────────────────────────────────────────────────────

  private requireKey(): void {
    if (!this.setting("apiKey")) {
      throw new Error("favorites require an API key (create one at nhentai.net › Account › API Keys)");
    }
  }

  async getFavorites(req: PagedRequest = {}): Promise<PagedResults<SeriesEntry>> {
    this.requireKey();
    const page = pageFromCursor(req.cursor);
    const data = await this.getJson<PaginatedGalleries>(`${BASE}/favorites?page=${page}&per_page=${PER_PAGE}`);
    const items = await this.listToEntries(data.result ?? []);
    // Prefer the server's page count when it's present; the favorites endpoint doesn't
    // reliably return `num_pages` (unlike galleries/search), and `page < (num_pages ?? 0)`
    // silently collapses to always-false when it's absent — stranding favorites on page 1.
    // Fall back to "a full page implies more" so the walk still advances (an over-count
    // self-corrects: the next page comes back empty and emits no further cursor).
    const hasMore = data.num_pages != null ? page < data.num_pages : items.length >= PER_PAGE;
    return { items, nextCursor: nextPageCursor(page, hasMore) };
  }

  async addFavorite(seriesId: string): Promise<void> {
    this.requireKey();
    // The favorite endpoint's response body isn't reliably JSON (often empty), so a status
    // check is all we can rely on — parsing it (as postJson does) throws on an otherwise
    // successful POST, which makes the caller's optimistic star revert even though the
    // favorite was recorded. Mirror removeFavorite/deleteReq: send, then check status only.
    const res = await this.request({
      url: `${BASE}/galleries/${encodeURIComponent(seriesId)}/favorite`,
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.status >= 400) throw new Error(`${res.status} ${res.statusText}`);
  }

  async removeFavorite(seriesId: string): Promise<void> {
    this.requireKey();
    await this.deleteReq(`${BASE}/galleries/${encodeURIComponent(seriesId)}/favorite`);
  }

  async isFavorite(seriesId: string): Promise<boolean> {
    this.requireKey();
    // Single O(1) status check — the API exposes it directly. (Previously this scanned every
    // favorites page sequentially, which was slow for large accounts and flipped to "not
    // favorited" if any page request errored mid-scan.)
    const data = await this.getJson<{ favorited: boolean }>(
      `${BASE}/galleries/${encodeURIComponent(seriesId)}/favorite`,
    );
    return data.favorited === true;
  }
}

export default defineBridge((host) => new NhentaiBridge(host));
