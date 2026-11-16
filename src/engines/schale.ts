/**
 * The engine Schale Network and HDoujin share: one front end and one JSON API
 * (`https://api.{apiDomain}`) behind it. A site file is configuration.
 *  - browse and search: `/books?s&sort&cat&page` (`s` takes the site's own terms, such as
 *    `title:"…"` and `language:"^english$"`), and `/books/popular` for this week's most read
 *  - details: `GET /books/detail/{id}/{key}` (a gallery is read directly, without chapters)
 *  - pages: `POST /books/detail/{id}/{key}?crt` lists the image sets by width, then
 *    `GET /books/data/{id}/{key}/{setId}/{setKey}/{width}?crt` lists the pages
 *
 * Browsing and details are open. Pages need the site's clearance token, `crt`: its front end gets
 * one from its own check (a Turnstile on the home page) and keeps it in the page's localStorage as
 * `clearance`. Without one, or when the API turns one down (an empty 403), the bridge asks for a
 * web check of the home page naming that key; the app hands the value back, and it is read from
 * secure storage under `webCheckStorageKey("clearance")`. The bridge never solves the check itself.
 *
 * The image CDN answers 400 unless the request carries the site's Origin, as its reader's do.
 */
import {
  BridgeBase,
  type BridgeInfo,
  type Filter,
  type FilterValue,
  type HttpResponse,
  type LinkTarget,
  type ListRequest,
  type Page,
  type PagedResults,
  type SearchRequest,
  type SeriesEntry,
  type SeriesInfo,
  type SeriesList,
  type SettingDescriptor,
  type SortOption,
  type TagGroup,
  challengeMessage,
  defineBridge,
  nextPageCursor,
  pageFromCursor,
  seriesGoneMessage,
  webCheckStorageKey,
} from "@comical/sdk";
import { standardGuards } from "comical-bridge-kit";
import { guardResponse } from "../core/guarded";
import { bridgeIcon } from "../core/icon";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
/** The localStorage key the site keeps its clearance token under. */
const CLEARANCE = "clearance";
const WIDTHS = ["1600", "1280", "980", "780", "0"] as const;
type Width = (typeof WIDTHS)[number];

const SORTS: ReadonlyArray<SortOption> = [
  { key: "date", label: "Recently posted" },
  { key: "8", label: "Most viewed" },
  { key: "9", label: "Most favorited" },
  { key: "2", label: "Title" },
  { key: "3", label: "Pages" },
];

const CATEGORIES: ReadonlyArray<[string, string]> = [
  ["2", "Manga"],
  ["4", "Doujinshi"],
  ["8", "Illustration"],
];

/** Tag namespaces, as the API numbers them. */
const NAMESPACES: Record<number, { label: string; kind: TagGroup["kind"] }> = {
  0: { label: "Tags", kind: "genre" },
  2: { label: "Circles", kind: "other" },
  3: { label: "Parodies", kind: "other" },
  5: { label: "Characters", kind: "other" },
  7: { label: "Uploader", kind: "other" },
  8: { label: "Male", kind: "genre" },
  9: { label: "Female", kind: "genre" },
  10: { label: "Mixed", kind: "genre" },
  11: { label: "Language", kind: "other" },
  12: { label: "Other", kind: "genre" },
};
const ARTIST = 1;

export interface SchaleSite {
  id: string;
  name: string;
  version: string;
  /** `https://host`, no trailing slash: the site's front end. */
  site: string;
  /** The API's domain: `api.` and `auth.` hosts under it. */
  apiDomain: string;
  /** The languages its language filter offers, as the API names them. */
  languages: ReadonlyArray<[value: string, label: string]>;
  linkHosts: string[];
}

interface Thumb {
  path: string;
  dimensions?: [number, number];
}

interface EntryDto {
  id: number;
  key: string;
  title: string;
  pages?: number;
  thumbnail?: Thumb;
}

interface BooksDto {
  entries?: EntryDto[];
  limit?: number;
  page?: number;
  total?: number;
}

interface DetailDto {
  id: number;
  key: string;
  title: string;
  title_short?: string | null;
  subtitle?: string | null;
  created_at?: number;
  updated_at?: number | null;
  thumbnails?: { base: string; main?: Thumb; entries?: Thumb[] };
  tags?: { name: string; namespace?: number }[];
}

type DataSets = Partial<Record<Width, { id?: number; key?: string } | null>>;

interface ImagesDto {
  base: string;
  entries: { path: string }[];
}

/** `{id}/{key}` from a gallery id or the site's `/g/{id}/{key}` path. */
function galleryOf(s: string): { id: string; key: string } | undefined {
  const m = /^(?:.*\/g\/)?(\d+)\/([0-9a-f]+)\/?(?:[?#].*)?$/i.exec(s);
  return m ? { id: m[1]!, key: m[2]! } : undefined;
}

/**
 * The image set to read: the chosen width, then the nearest larger ones, the original, and the
 * smaller ones, largest first.
 */
export function pickWidth(sets: DataSets, wanted: string): { width: Width; id: number; key: string } | undefined {
  const sized = ["780", "980", "1280", "1600"] as const;
  const w = (WIDTHS as readonly string[]).includes(wanted) ? (wanted as Width) : "1280";
  const order: Width[] =
    w === "0"
      ? ["0", ...[...sized].reverse()]
      : [w, ...sized.filter((s) => Number(s) > Number(w)), "0", ...sized.filter((s) => Number(s) < Number(w)).reverse()];
  for (const width of order) {
    const set = sets[width];
    if (set?.id !== undefined && set.key) return { width, id: set.id, key: set.key };
  }
  return undefined;
}

export class SchaleBridge extends BridgeBase {
  /** The platform User-Agent when the host gives a browser one (the web check's web view sends it too), else a fixed desktop Chrome one. */
  private get ua(): string {
    const host = this.userAgent;
    return host && host.startsWith("Mozilla/5.0") ? host : UA;
  }

  readonly info: BridgeInfo;
  private readonly guards: ReturnType<typeof standardGuards>;
  private readonly api: string;

  constructor(
    hostCaps: ConstructorParameters<typeof BridgeBase>[0],
    private readonly cfg: SchaleSite,
  ) {
    super(hostCaps);
    this.api = `https://api.${cfg.apiDomain}`;
    this.info = {
      id: `pos5drow.${cfg.id}`,
      name: cfg.name,
      version: cfg.version,
      contractVersion: "2.1.0",
      languages: ["multi"],
      nsfw: true,
      capabilities: ["lists", "search", "filters", "sort", "settings", "direct"],
      iconUrl: bridgeIcon(cfg.id),
      rateLimit: { maxConcurrent: 2, minIntervalMs: 350 },
      assetRateLimit: { maxConcurrent: 4, minIntervalMs: 100 },
      linkHosts: cfg.linkHosts,
      images: { hosts: ["erocdn.net"], headers: { Origin: cfg.site, Referer: `${cfg.site}/` } },
    };
    this.guards = standardGuards([new URL(cfg.site).hostname, cfg.apiDomain]);
  }

  getSettings(): SettingDescriptor[] {
    return [
      {
        type: "enum",
        key: "width",
        label: "Page size",
        options: [
          { value: "780", label: "780 px wide" },
          { value: "980", label: "980 px wide" },
          { value: "1280", label: "1280 px wide" },
          { value: "1600", label: "1600 px wide" },
          { value: "0", label: "Original" },
        ],
        default: "1280",
      },
    ];
  }

  protected override async request(req: Parameters<BridgeBase["request"]>[0]): Promise<HttpResponse> {
    return guardResponse(await super.request(req), this.guards, req);
  }

  private headers(): Record<string, string> {
    return { "User-Agent": this.ua, Accept: "application/json", Origin: this.cfg.site, Referer: `${this.cfg.site}/` };
  }

  private json<T>(res: HttpResponse, what: string): T {
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new Error(`${this.cfg.name} sent something that isn't JSON for ${what}`);
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await this.request({ url: `${this.api}${path}`, headers: this.headers() });
    const what = path.split("?")[0]!;
    if (res.status === 404) throw new Error(seriesGoneMessage());
    if (res.status >= 400) throw new Error(`${this.cfg.name} answered HTTP ${res.status} for ${what}`);
    return this.json<T>(res, what);
  }

  // ── Clearance ───────────────────────────────────────────────────────────────

  /** The web check that gets a clearance token: the home page, which asks for one when it has none. */
  private needsCheck(): Error {
    return new Error(
      challengeMessage({
        url: `${this.cfg.site}/`,
        userAgent: this.ua,
        storage: [CLEARANCE],
        reason: `${this.cfg.name} wants to check this is a person before showing pages`,
      }),
    );
  }

  /** A token-gated call. A missing or refused token asks for a web check (and forgets the refused one). */
  private async withClearance<T>(method: "GET" | "POST", path: string): Promise<T> {
    const secure = this.storage.secure;
    const token = await secure?.get(webCheckStorageKey(CLEARANCE));
    if (!token) throw this.needsCheck();
    const url = `${this.api}${path}${path.includes("?") ? "&" : "?"}crt=${encodeURIComponent(token)}`;
    const res = await this.request({ url, method, headers: this.headers(), ...(method === "POST" ? { body: "" } : {}) });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      await secure?.delete(webCheckStorageKey(CLEARANCE));
      throw this.needsCheck();
    }
    const what = path.split("?")[0]!;
    if (res.status === 404) throw new Error(seriesGoneMessage("chapter removed from the source"));
    if (res.status >= 400) throw new Error(`${this.cfg.name} answered HTTP ${res.status} for ${what}`);
    return this.json<T>(res, what);
  }

  // ── Lists & search ──────────────────────────────────────────────────────────

  private entry(e: EntryDto): SeriesEntry {
    const out: SeriesEntry = { id: `${e.id}/${e.key}`, title: e.title.trim() };
    if (e.thumbnail?.path) {
      out.thumbnailUrl = e.thumbnail.path;
      const [w, h] = e.thumbnail.dimensions ?? [];
      if (w && h) out.thumbnailAspect = w / h;
    }
    if (e.pages) out.subtitle = `${e.pages} pages`;
    return out;
  }

  private results(b: BooksDto, page: number): PagedResults<SeriesEntry> {
    const items = (b.entries ?? []).map((e) => this.entry(e));
    const more = !!b.limit && !!b.total && (b.page ?? page) * b.limit < b.total;
    return { items, nextCursor: nextPageCursor(page, more && items.length > 0) };
  }

  async getLists(): Promise<SeriesList[]> {
    return [
      { id: "latest", name: "Recently posted", layout: "grid", featured: true },
      { id: "popular", name: "Popular this week", layout: "grid", featured: true },
      { id: "views", name: "Most viewed", layout: "grid" },
      { id: "favorites", name: "Most favorited", layout: "grid" },
    ];
  }

  async getListItems(listId: string, req: ListRequest = {}): Promise<PagedResults<SeriesEntry>> {
    const page = pageFromCursor(req.cursor);
    const q = new URLSearchParams();
    let path = "/books";
    if (listId === "popular") path = "/books/popular";
    else if (listId === "views") q.set("sort", "8");
    else if (listId === "favorites") q.set("sort", "9");
    else if (listId !== "latest") throw new Error(`unknown list: ${listId}`);
    q.set("page", String(page));
    return this.results(await this.get<BooksDto>(`${path}?${q}`), page);
  }

  async getFilters(): Promise<Filter[]> {
    return [
      { type: "multiselect", key: "category", label: "Category", options: CATEGORIES.map(([value, label]) => ({ value, label })) },
      { type: "select", key: "language", label: "Language", options: this.cfg.languages.map(([value, label]) => ({ value, label })) },
      { type: "text", key: "tags", label: "Tags (comma-separated; - to exclude)" },
      { type: "text", key: "artist", label: "Artist" },
      { type: "text", key: "parody", label: "Parody" },
      { type: "text", key: "pages", label: "Pages (for example >20)" },
    ];
  }

  async getSortOptions(): Promise<SortOption[]> {
    return [...SORTS];
  }

  async getSearchResults(req: SearchRequest): Promise<PagedResults<SeriesEntry>> {
    const page = pageFromCursor(req.cursor);
    const q = new URLSearchParams();
    const terms = searchTerms(req.text, req.filters ?? []);
    if (terms) q.set("s", terms);
    const cat = (req.filters ?? []).find((f) => f.key === "category")?.value;
    if (Array.isArray(cat) && cat.length) q.set("cat", String(cat.reduce((sum, v) => sum + (Number(v) || 0), 0)));
    if (req.sort && req.sort.key !== "date") q.set("sort", req.sort.key);
    q.set("page", String(page));
    return this.results(await this.get<BooksDto>(`/books?${q}`), page);
  }

  // ── Details, chapters, pages ────────────────────────────────────────────────

  private async detail(seriesId: string): Promise<DetailDto> {
    const g = galleryOf(seriesId);
    if (!g) throw new Error(seriesGoneMessage());
    return this.get<DetailDto>(`/books/detail/${g.id}/${g.key}`);
  }

  async getSeriesDetails(seriesId: string): Promise<SeriesInfo> {
    const d = await this.detail(seriesId);
    const info: SeriesInfo = { id: seriesId, title: d.title.trim(), shareUrl: `${this.cfg.site}/g/${d.id}/${d.key}`, status: "completed" };
    const main = d.thumbnails?.main;
    if (d.thumbnails && main?.path) {
      info.thumbnailUrl = d.thumbnails.base + main.path;
      const [w, h] = main.dimensions ?? [];
      if (w && h) info.thumbnailAspect = w / h;
    }
    const alt = [d.title_short, d.subtitle].map((t) => t?.trim()).filter((t): t is string => !!t && t !== info.title);
    if (alt.length) info.altTitles = [...new Set(alt)];
    const artists = (d.tags ?? []).filter((t) => t.namespace === ARTIST).map((t) => t.name);
    if (artists.length) {
      info.authors = artists.map((name) => ({ name }));
      info.author = artists.join(", ");
    }
    const groups = new Map<number, string[]>();
    for (const t of d.tags ?? []) {
      const ns = t.namespace ?? 0;
      if (ns === ARTIST || !NAMESPACES[ns] || (ns === 7 && t.name === "anonymous")) continue;
      groups.set(ns, [...(groups.get(ns) ?? []), t.name]);
    }
    const tagGroups: TagGroup[] = [];
    for (const [ns, tags] of [...groups].sort(([a], [b]) => a - b)) tagGroups.push({ label: NAMESPACES[ns]!.label, kind: NAMESPACES[ns]!.kind, tags: [...new Set(tags)] });
    if (tagGroups.length) info.tagGroups = tagGroups;
    const pages = d.thumbnails?.entries?.length;
    if (pages) info.description = `${pages} pages.`;
    return info;
  }

  /** A gallery is one flat run of pages (capability "direct"), as on the other gallery sites. */
  override async getSeriesPages(seriesId: string): Promise<Page[]> {
    const g = galleryOf(seriesId);
    if (!g) throw new Error(seriesGoneMessage("chapter removed from the source"));
    const sets = await this.withClearance<{ data?: DataSets }>("POST", `/books/detail/${g.id}/${g.key}`);
    const pick = pickWidth(sets.data ?? {}, String(this.settings["width"] ?? "1280"));
    if (!pick) throw new Error(`${this.cfg.name}: this gallery has no pages to show`);
    const [images, detail] = await Promise.all([
      this.withClearance<ImagesDto>("GET", `/books/data/${g.id}/${g.key}/${pick.id}/${pick.key}/${pick.width}`),
      this.detail(`${g.id}/${g.key}`).catch(() => undefined),
    ]);
    const thumbs = detail?.thumbnails;
    return images.entries.map((e, index) => {
      const p: Page = { index, imageUrl: images.base + e.path };
      const t = thumbs?.entries?.[index]?.path;
      if (thumbs && t) p.thumbnail = { kind: "image", url: thumbs.base + t };
      return p;
    });
  }

  // ── Links ───────────────────────────────────────────────────────────────────

  async resolveUrl(url: string): Promise<LinkTarget | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (!this.cfg.linkHosts.includes(u.hostname.replace(/^www\./, ""))) return null;
    const g = /^\/g\/(\d+)\/([0-9a-f]+)/i.exec(u.pathname);
    return g ? { seriesId: `${g[1]}/${g[2]}` } : null;
  }
}

/** The site's `s` terms for a search: the text as a title, then the filters' terms. */
export function searchTerms(text: string, filters: readonly FilterValue[]): string {
  const terms: string[] = [];
  const t = text.trim().replace(/"/g, "");
  if (t) terms.push(`title:"${t}"`);
  for (const f of filters) {
    if (typeof f.value !== "string" || !f.value.trim()) continue;
    const v = f.value.trim().replace(/"/g, "");
    if (f.key === "language") terms.push(`language:"^${v}$"`);
    else if (f.key === "pages") terms.push(`pages:${v.replace(/\s+/g, "")}`);
    else if (f.key === "tags" || f.key === "artist" || f.key === "parody") {
      const ns = f.key === "tags" ? "tag" : f.key;
      const parts = v.split(",").map((s) => s.trim()).filter(Boolean);
      const [excluded, included] = [parts.filter((p) => p.startsWith("-")), parts.filter((p) => !p.startsWith("-"))];
      // One term per included tag (terms are AND-ed); exclusions go together.
      for (const p of included) terms.push(`${ns}:"${p}"`);
      if (excluded.length) terms.push(`${ns}:"${excluded.join(",")}"`);
    }
  }
  return terms.join(" ");
}

export const schaleSite = (cfg: SchaleSite) => defineBridge((host) => new SchaleBridge(host, cfg));
