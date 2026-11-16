/**
 * The "kemono" engine: archives of creators' posts (Patreon, Pixiv Fanbox, Fantia, Gumroad…) that
 * share one JSON API (`/api/v1`). Kemono and Pawchive run on it; a site file is configuration.
 *  - creators: `/api/v1/creators`, the whole list in one response (12–16 MB, ~100k creators), which
 *    the sites' own artist pages download too. It is fetched once and kept for 30 minutes,
 *    compacted, and lists and search work over it (there is no server-side creator search).
 *  - a series is a creator (`{service}/{id}`): profile `/api/v1/{service}/user/{id}/profile`, posts
 *    `/api/v1/{service}/user/{id}/posts?o={offset}` (50 a page); each post with images is a chapter
 *  - pages: the post (`/api/v1/{service}/user/{id}/post/{postId}`, wrapped in `post` on some
 *    sites): its file and attachments, full size or from the thumbnail server (a setting)
 *
 * API calls send `Accept: text/css`, which the sites' DDoS-Guard asks scripts to. Discord archives
 * aren't posts with pages and are left out.
 */
import {
  BridgeBase,
  type BridgeInfo,
  type Chapter,
  type Filter,
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
  defineBridge,
  nextPageCursor,
  pageFromCursor,
  seriesGoneMessage,
} from "@comical/sdk";
import { standardGuards } from "comical-bridge-kit";
import { guardResponse } from "../core/guarded";
import { bridgeIcon } from "../core/icon";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const PER_PAGE = 50;
const LIST_TTL_MS = 30 * 60 * 1000;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp)$/i;

const SERVICES: ReadonlyArray<[string, string]> = [
  ["patreon", "Patreon"],
  ["fanbox", "Pixiv Fanbox"],
  ["fantia", "Fantia"],
  ["gumroad", "Gumroad"],
  ["boosty", "Boosty"],
  ["subscribestar", "SubscribeStar"],
  ["dlsite", "DLsite"],
  ["afdian", "Afdian"],
];
const serviceName = (s: string) => SERVICES.find(([k]) => k === s)?.[1] ?? s.charAt(0).toUpperCase() + s.slice(1);

/** A creator, compacted: service, id, name, favorites, last update (epoch seconds). */
type Creator = [service: string, id: string, name: string, favorited: number, updated: number];

interface FileDto {
  name?: string | null;
  path?: string | null;
  /** The file server holding it (Pawchive). */
  server?: string | null;
  /** A signed, expiring link for a file the site only previews (Pawchive). */
  temp_url?: string | null;
  preview_only?: boolean;
}

export interface KemonoSite {
  id: string;
  name: string;
  version: string;
  /** `https://host`, no trailing slash. */
  site: string;
  /** Where thumbnails live: `${thumbnails}/thumbnail/data{path}`. */
  thumbnails: string;
  /** Where creator icons live: `${icons}/icons/{service}/{id}`. */
  icons: string;
  /** The full-size URL of a file. */
  fullImage(f: { path: string; name?: string; server?: string; tempUrl?: string }): string;
  /** Which page images to use when the user hasn't picked. */
  defaultImages: "thumbnail" | "full";
  /** The default's label suffix, and the other's (why one is the default). */
  imageLabels: { thumbnail: string; full: string };
  /**
   * The User-Agent to send. A browser's by default; a site that asks scripts to identify
   * themselves (and blocks those pretending to be a browser) gets an honest one.
   */
  userAgent?: string;
  /** Requests per second and concurrent downloads the site asks for. */
  rateLimit: BridgeInfo["rateLimit"];
  assetRateLimit: BridgeInfo["assetRateLimit"];
  linkHosts: string[];
}

interface PostDto {
  id: string;
  user: string;
  service: string;
  title?: string | null;
  published?: string | null;
  edited?: string | null;
  file?: FileDto | null;
  attachments?: FileDto[] | null;
}

interface ImageFile {
  path: string;
  name?: string;
  server?: string;
  tempUrl?: string;
}

/** A post's images: its file, then attachments, by path, once each. */
function images(p: PostDto): ImageFile[] {
  const seen = new Set<string>();
  const out: ImageFile[] = [];
  for (const f of [p.file, ...(p.attachments ?? [])]) {
    if (!f?.path || !IMAGE_EXT.test(f.path) || seen.has(f.path)) continue;
    seen.add(f.path);
    const img: ImageFile = { path: f.path };
    if (f.name) img.name = f.name;
    if (f.server) img.server = f.server;
    if (f.preview_only && f.temp_url) img.tempUrl = f.temp_url;
    out.push(img);
  }
  return out;
}

/** An API timestamp (`2025-10-01T00:19:46`, UTC without a zone) as epoch ms. */
function timestamp(s: string | null | undefined): number | undefined {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return undefined;
  const ms = Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(ms) ? ms : undefined;
}

export class KemonoBridge extends BridgeBase {
  readonly info: BridgeInfo;
  private readonly guards: ReturnType<typeof standardGuards>;

  constructor(
    hostCaps: ConstructorParameters<typeof BridgeBase>[0],
    private readonly cfg: KemonoSite,
  ) {
    super(hostCaps);
    this.info = {
      id: `pos5drow.${cfg.id}`,
      name: cfg.name,
      version: cfg.version,
      contractVersion: "2.1.0",
      languages: ["multi"],
      nsfw: true,
      capabilities: ["lists", "search", "filters", "sort", "settings"],
      iconUrl: bridgeIcon(cfg.id),
      rateLimit: cfg.rateLimit,
      assetRateLimit: cfg.assetRateLimit,
      linkHosts: cfg.linkHosts,
    };
    this.guards = standardGuards([new URL(cfg.site).hostname]);
  }
  private creators?: { at: number; list: Creator[] };
  private loading?: Promise<Creator[]> | undefined;

  getSettings(): SettingDescriptor[] {
    return [
      {
        type: "enum",
        key: "images",
        label: "Page images",
        options: [
          { value: "thumbnail", label: `Thumbnails (${this.cfg.imageLabels.thumbnail})` },
          { value: "full", label: `Full size (${this.cfg.imageLabels.full})` },
        ],
        default: this.cfg.defaultImages,
      },
      {
        type: "enum",
        key: "posts",
        label: "Posts to load per creator",
        options: ["50", "100", "250", "500", "1000"].map((value) => ({ value, label: value })),
        default: "100",
      },
    ];
  }

  protected override async request(req: Parameters<BridgeBase["request"]>[0]): Promise<HttpResponse> {
    return guardResponse(await super.request(req), this.guards, req);
  }

  private async api<T>(path: string): Promise<T> {
    const res = await this.request({ url: `${this.cfg.site}/api/v1${path}`, headers: { "User-Agent": this.cfg.userAgent ?? BROWSER_UA, Accept: "text/css" } });
    if (res.status === 404) throw new Error(seriesGoneMessage());
    if (res.status >= 400) throw new Error(`${this.cfg.name} answered HTTP ${res.status} for ${path.split("?")[0]}`);
    try {
      return JSON.parse(res.body) as T;
    } catch {
      throw new Error(`${this.cfg.name} sent something that isn't JSON for ${path.split("?")[0]}`);
    }
  }

  /** Every creator (Discord left out), fetched at most every 30 minutes. */
  private async allCreators(): Promise<Creator[]> {
    if (this.creators && Date.now() - this.creators.at < LIST_TTL_MS) return this.creators.list;
    this.loading ??= (async () => {
      try {
        const raw = await this.api<{ id: string; name: string; service: string; favorited?: number; updated?: number | string }[]>("/creators");
        const list: Creator[] = [];
        for (const c of raw) {
          if (c.service === "discord") continue;
          const updated = typeof c.updated === "number" ? c.updated : Math.floor((timestamp(c.updated) ?? 0) / 1000);
          list.push([c.service, c.id, c.name, c.favorited ?? 0, updated]);
        }
        this.creators = { at: Date.now(), list };
        return list;
      } finally {
        this.loading = undefined;
      }
    })();
    return this.loading;
  }

  private entry(c: Creator): SeriesEntry {
    return { id: `${c[0]}/${c[1]}`, title: c[2], subtitle: serviceName(c[0]), thumbnailUrl: `${this.cfg.icons}/icons/${c[0]}/${c[1]}` };
  }

  private paged(list: Creator[], cursor: string | undefined): PagedResults<SeriesEntry> {
    const page = pageFromCursor(cursor);
    const slice = list.slice((page - 1) * PER_PAGE, page * PER_PAGE);
    return { items: slice.map((c) => this.entry(c)), nextCursor: nextPageCursor(page, page * PER_PAGE < list.length) };
  }

  // ── Lists & search ──────────────────────────────────────────────────────────

  async getLists(): Promise<SeriesList[]> {
    return [
      { id: "popular", name: "Most favorited", layout: "grid", featured: true },
      { id: "updated", name: "Recently updated", layout: "grid", featured: true },
    ];
  }

  async getListItems(listId: string, req: ListRequest = {}): Promise<PagedResults<SeriesEntry>> {
    if (listId !== "popular" && listId !== "updated") throw new Error(`unknown list: ${listId}`);
    const list = [...(await this.allCreators())].sort(listId === "popular" ? (a, b) => b[3] - a[3] : (a, b) => b[4] - a[4]);
    return this.paged(list, req.cursor);
  }

  async getFilters(): Promise<Filter[]> {
    return [{ type: "multiselect", key: "service", label: "Service", options: SERVICES.map(([value, label]) => ({ value, label })), excludable: true }];
  }

  async getSortOptions(): Promise<SortOption[]> {
    return [
      { key: "popular", label: "Favorites" },
      { key: "updated", label: "Last update" },
      { key: "title", label: "Name" },
    ];
  }

  async getSearchResults(req: SearchRequest): Promise<PagedResults<SeriesEntry>> {
    const q = req.text.trim().toLowerCase();
    let include: string[] = [];
    let exclude: string[] = [];
    const f = req.filters?.find((x) => x.key === "service")?.value;
    if (Array.isArray(f)) include = f as string[];
    else if (f && typeof f === "object") ({ include = [], exclude = [] } = f as { include?: string[]; exclude?: string[] });
    const hits = (await this.allCreators()).filter(
      (c) => (!q || c[2].toLowerCase().includes(q)) && (!include.length || include.includes(c[0])) && !exclude.includes(c[0]),
    );
    const key = req.sort?.key ?? "popular";
    const dir = req.sort?.ascending ? -1 : 1;
    hits.sort(
      key === "title" ? (a, b) => a[2].localeCompare(b[2]) * (req.sort?.ascending === false ? -1 : 1)
      : key === "updated" ? (a, b) => (b[4] - a[4]) * dir
      : (a, b) => (b[3] - a[3]) * dir,
    );
    return this.paged(hits, req.cursor);
  }

  // ── Details, chapters, pages ────────────────────────────────────────────────

  private split(seriesId: string): [string, string] {
    const m = /^([a-z]+)\/([\w-]+)$/.exec(seriesId);
    if (!m) throw new Error(seriesGoneMessage());
    return [m[1]!, m[2]!];
  }

  async getSeriesDetails(seriesId: string): Promise<SeriesInfo> {
    const [service, id] = this.split(seriesId);
    const p = await this.api<{ name: string; post_count?: number; updated?: string }>(`/${service}/user/${id}/profile`);
    const info: SeriesInfo = {
      id: seriesId,
      title: p.name,
      thumbnailUrl: `${this.cfg.icons}/icons/${service}/${id}`,
      shareUrl: `${this.cfg.site}/${service}/user/${id}`,
      authors: [{ name: p.name }],
      author: p.name,
      tagGroups: [{ label: "Service", kind: "other", tags: [serviceName(service)] }],
      status: "ongoing",
    };
    if (typeof p.post_count === "number") info.description = `${p.post_count} posts archived from ${serviceName(service)}.`;
    return info;
  }

  override async getChapters(seriesId: string): Promise<Chapter[]> {
    const [service, id] = this.split(seriesId);
    const wanted = Math.min(Number(this.settings["posts"]) || 100, 1000);
    const out: Chapter[] = [];
    for (let offset = 0; offset < wanted; offset += PER_PAGE) {
      const posts = await this.api<PostDto[]>(`/${service}/user/${id}/posts?o=${offset}`);
      for (const p of posts) {
        if (images(p).length === 0) continue;
        const at = timestamp(p.published) ?? timestamp(p.edited);
        const date = at === undefined ? "unknown date" : new Date(at).toISOString().slice(0, 10);
        const ch: Chapter = { id: p.id, name: p.title?.trim() || `Post from ${date}` };
        if (at !== undefined) ch.publishedAt = at;
        out.push(ch);
      }
      if (posts.length < PER_PAGE) break;
    }
    return out;
  }

  override async getChapterPages(seriesId: string, chapterId: string): Promise<Page[]> {
    const [service, id] = this.split(seriesId);
    if (!/^[\w-]+$/.test(chapterId)) throw new Error(seriesGoneMessage("chapter removed from the source"));
    const body = await this.api<{ post?: PostDto } & PostDto>(`/${service}/user/${id}/post/${chapterId}`);
    const post = body.post ?? body;
    const choice = this.settings["images"];
    const full = (choice === "full" || choice === "thumbnail" ? choice : this.cfg.defaultImages) === "full";
    return images(post).map((f, index) => {
      const thumb = `${this.cfg.thumbnails}/thumbnail/data${f.path}`;
      const imageUrl = full ? this.cfg.fullImage(f) : thumb;
      return { index, imageUrl, thumbnail: { kind: "image" as const, url: thumb } };
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
    const m = /^\/([a-z]+)\/user\/([\w-]+)(?:\/post\/([\w-]+))?/.exec(u.pathname);
    if (!m || m[1] === "discord") return null;
    const seriesId = `${m[1]}/${m[2]}`;
    return m[3] ? { seriesId, chapterId: m[3] } : { seriesId };
  }
}

export const kemonoSite = (cfg: KemonoSite) => defineBridge((host) => new KemonoBridge(host, cfg));
