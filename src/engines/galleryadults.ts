/**
 * The "galleryadults" engine: one shared implementation for the family of gallery sites built on the
 * same script (HentaiFox, IMHentai, HentaiRox, AsmHentai, …). Keiyoushi runs about a dozen on it.
 *
 *  - browse: `/language/{lang}/popular/` and `/language/{lang}/` (newest), `div.thumb` cards
 *  - search: `/search/?…` — a plain query (`q`) on some sites, a query with sort/language flags
 *    (`key` + `pp`/`lt`/`en`/`jp`/…) on others
 *  - a series is a gallery (`/gallery/{id}/`) with a single chapter
 *  - pages: the gallery page lists every page as JSON (`$.parseJSON('{"1":"j,w,h",…}')`, extension
 *    letter then size; thumbnails are `{n}t.jpg`) with the image directory in hidden inputs
 *    (`load_dir`, `load_id`, and `load_server` on sites that shard images across `m{n}.{domain}`;
 *    otherwise the cover's host)
 *
 * A site file is configuration: its address, languages, how it pages and searches, and where its
 * gallery page keeps the cover. Series ids are gallery ids.
 */
import {
  BridgeBase,
  type BridgeInfo,
  type Chapter,
  type CheerioRoot,
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
  defineBridge,
  nextPageCursor,
  pageFromCursor,
  seriesGoneMessage,
} from "@comical/sdk";
import { parseDate, standardGuards } from "comical-bridge-kit";
import { guardResponse } from "../core/guarded";
import { bridgeIcon } from "../core/icon";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export interface GallerySite {
  id: string;
  name: string;
  version: string;
  /** `https://host`, no trailing slash. */
  site: string;
  /** Setting value → [label, the site's language path segment ("" = every language)]. */
  languages: Record<string, [string, string]>;
  defaultLanguage: string;
  /** How a list pages: `/pag/{n}/` after the path, or `?page={n}`. */
  paging: "pag" | "query";
  /**
   * `basic`: `/search/?q=terms+language` (terms joined by `+`).
   * `flags`: `/search/?key=terms` with sort flags (`pp`, `lt`) and a flag per language code.
   */
  search: "basic" | "flags";
  /** For `flags` search: the site's language path segment → its flag parameter. */
  languageFlags?: Record<string, string>;
  /** The gallery page's cover image. */
  coverSelector: string;
  /** Hosts serving covers and pages (for the guards). */
  imageHosts: string[];
}

const EXTENSIONS: Record<string, string> = { j: "jpg", p: "png", b: "bmp", g: "gif", w: "webp" };

/** An image attribute as the lazy loaders on these sites set it. */
function imgSrc($el: { attr(name: string): string | undefined }): string | undefined {
  const src = $el.attr("data-src") || $el.attr("data-lazy-src") || $el.attr("data-cfsrc") || $el.attr("src");
  return src && /^(https?:)?\/\//.test(src) ? (src.startsWith("//") ? `https:${src}` : src) : undefined;
}

export class GalleryAdultsBridge extends BridgeBase {
  readonly info: BridgeInfo;
  private readonly guards: ReturnType<typeof standardGuards>;
  private readonly siteHost: string;

  constructor(
    hostCaps: ConstructorParameters<typeof BridgeBase>[0],
    private readonly cfg: GallerySite,
  ) {
    super(hostCaps);
    this.siteHost = new URL(cfg.site).hostname;
    this.info = {
      id: `pos5drow.${cfg.id}`,
      name: cfg.name,
      version: cfg.version,
      contractVersion: "2.1.0",
      languages: ["multi"],
      nsfw: true,
      capabilities: ["lists", "search", "sort", "settings"],
      iconUrl: bridgeIcon(cfg.id),
      rateLimit: { maxConcurrent: 2, minIntervalMs: 500 },
      assetRateLimit: { maxConcurrent: 4, minIntervalMs: 100 },
      linkHosts: [this.siteHost],
    };
    this.guards = standardGuards([this.siteHost, ...cfg.imageHosts]);
  }

  getSettings(): SettingDescriptor[] {
    return [
      {
        type: "enum",
        key: "language",
        label: "Language",
        options: Object.entries(this.cfg.languages).map(([value, [label]]) => ({ value, label })),
        default: this.cfg.defaultLanguage,
      },
    ];
  }

  /** The chosen language's path segment ("" for every language). */
  private get lang(): string {
    const v = this.settings["language"];
    return ((typeof v === "string" && this.cfg.languages[v]) || this.cfg.languages[this.cfg.defaultLanguage]!)[1];
  }

  protected override async request(req: Parameters<BridgeBase["request"]>[0]): Promise<HttpResponse> {
    return guardResponse(await super.request(req), this.guards, req);
  }

  private async page(url: string): Promise<CheerioRoot> {
    const res = await this.request({ url, headers: { "User-Agent": UA, Accept: "text/html", Referer: `${this.cfg.site}/` } });
    if (res.status === 404) throw new Error(seriesGoneMessage());
    if (res.status >= 400) throw new Error(`${this.cfg.name} answered HTTP ${res.status} for ${url}`);
    return this.parse(res.body);
  }

  /** `path` (ending in `/`, or carrying a query) at page `n`. */
  private paged(path: string, n: number): string {
    if (n <= 1) return `${this.cfg.site}${path}`;
    if (this.cfg.paging === "query" || path.includes("?")) return `${this.cfg.site}${path}${path.includes("?") ? "&" : "?"}page=${n}`;
    return `${this.cfg.site}${path}pag/${n}/`;
  }

  private cards($: CheerioRoot): SeriesEntry[] {
    const seen = new Set<string>();
    const out: SeriesEntry[] = [];
    $("div.thumb").each((_, el) => {
      const $el = $(el);
      // Related galleries on a gallery page are cards too; only the listing's own count here.
      const href = $el.find(".inner_thumb a").first().attr("href") ?? "";
      const id = /\/gallery\/(\d+)/.exec(href)?.[1];
      if (!id || seen.has(id)) return;
      seen.add(id);
      const title = $el.find(".caption").first().text().replace(/\s+/g, " ").trim() || $el.find(".inner_thumb img").attr("alt")?.trim() || id;
      const e: SeriesEntry = { id, title };
      const cover = imgSrc($el.find(".inner_thumb img").first());
      if (cover) e.thumbnailUrl = cover;
      out.push(e);
    });
    return out;
  }

  private hasNext($: CheerioRoot): boolean {
    return $(".pagination li.active + li:not(.disabled) a, a[rel='next']").length > 0;
  }

  // ── Lists & search ──────────────────────────────────────────────────────────

  async getLists(): Promise<SeriesList[]> {
    return [
      { id: "popular", name: "Popular", layout: "grid", featured: true },
      { id: "latest", name: "Latest", layout: "grid", featured: true },
    ];
  }

  async getListItems(listId: string, req: ListRequest = {}): Promise<PagedResults<SeriesEntry>> {
    if (listId !== "popular" && listId !== "latest") throw new Error(`unknown list: ${listId}`);
    const n = pageFromCursor(req.cursor);
    const base = this.lang ? `/language/${this.lang}/` : "/";
    const path = listId === "popular" ? `${base}popular/` : base;
    const $ = await this.page(this.paged(path, n));
    return { items: this.cards($), nextCursor: nextPageCursor(n, this.hasNext($)) };
  }

  async getSortOptions(): Promise<SortOption[]> {
    return [
      { key: "latest", label: "Latest" },
      { key: "popular", label: "Popular" },
    ];
  }

  async getSearchResults(req: SearchRequest): Promise<PagedResults<SeriesEntry>> {
    const text = req.text.trim();
    // A gallery number opens that gallery.
    if (/^\d+$/.test(text)) {
      const info = await this.getSeriesDetails(text);
      const e: SeriesEntry = { id: info.id, title: info.title };
      if (info.thumbnailUrl) e.thumbnailUrl = info.thumbnailUrl;
      return { items: [e] };
    }
    const n = pageFromCursor(req.cursor);
    const popular = req.sort?.key === "popular";
    const terms = text.replace(/\s+/g, " ");
    let path: string;
    if (this.cfg.search === "basic") {
      const q = [terms, this.lang].filter(Boolean).join(" ").replace(/ /g, "+");
      path = `/search/?q=${encodeURIComponent(q).replace(/%2B/g, "+")}${popular ? "&sort=popular" : ""}`;
    } else {
      const q = new URLSearchParams({ pp: popular ? "1" : "0", lt: popular ? "0" : "1" });
      for (const [lang, flag] of Object.entries(this.cfg.languageFlags ?? {})) q.set(flag, !this.lang || this.lang === lang ? "1" : "0");
      q.set("key", terms);
      path = `/search/?${q}`;
    }
    const $ = await this.page(this.paged(path, n));
    return { items: this.cards($), nextCursor: nextPageCursor(n, this.hasNext($)) };
  }

  // ── Details, chapter, pages ─────────────────────────────────────────────────

  private gallery(seriesId: string): Promise<CheerioRoot> {
    if (!/^\d+$/.test(seriesId)) throw new Error(seriesGoneMessage());
    return this.page(`${this.cfg.site}/gallery/${seriesId}/`);
  }

  /** The names linked under an info label ("Tags", "Artists"…), however the site lays them out. */
  private infoNames($: CheerioRoot, label: string): string[] {
    const lower = label.toLowerCase();
    let links = $(`ul.${lower} a`);
    if (!links.length) {
      links = $("ul.galleries_info li")
        .filter((_, li) => $(li).find(".tags_text").first().text().trim().toLowerCase().startsWith(lower))
        .find("a.tag");
    }
    return [
      ...new Set(
        links
          .toArray()
          .map((a) => {
            const $a = $(a).clone();
            $a.find(".badge, .t_badge, .split_tag").remove();
            return $a.text().replace(/\s+/g, " ").trim();
          })
          .filter(Boolean),
      ),
    ];
  }

  async getSeriesDetails(seriesId: string): Promise<SeriesInfo> {
    const $ = await this.gallery(seriesId);
    const title = $("h1").first().text().replace(/\s+/g, " ").trim();
    if (!title) throw new Error(seriesGoneMessage());
    const info: SeriesInfo = { id: seriesId, title, status: "completed", shareUrl: `${this.cfg.site}/gallery/${seriesId}/` };
    const cover = imgSrc($(this.cfg.coverSelector).first());
    if (cover) info.thumbnailUrl = cover;
    const alt = $("h1 + h2, .subtitle").first().text().replace(/\s+/g, " ").trim();
    if (alt && alt !== title) info.altTitles = [alt];
    const artists = this.infoNames($, "Artists");
    const groups = this.infoNames($, "Groups");
    const credits = artists.length ? artists : groups;
    if (credits.length) {
      info.authors = credits.map((name) => ({ name }));
      info.author = credits.join(", ");
    }
    const tagGroups: TagGroup[] = [];
    const add = (label: string, kind: TagGroup["kind"], tags: string[]) => {
      if (tags.length) tagGroups.push({ label, kind, tags });
    };
    add("Tags", "genre", this.infoNames($, "Tags"));
    add("Parodies", "other", this.infoNames($, "Parodies"));
    add("Characters", "other", this.infoNames($, "Characters"));
    add("Groups", "other", groups);
    add("Languages", "other", this.infoNames($, "Languages"));
    add("Category", "format", [...this.infoNames($, "Categories"), ...this.infoNames($, "Category")]);
    if (tagGroups.length) info.tagGroups = tagGroups;
    const pages = $("#load_pages").attr("value");
    if (pages) info.description = `${pages} pages`;
    return info;
  }

  override async getChapters(seriesId: string): Promise<Chapter[]> {
    const $ = await this.gallery(seriesId);
    const ch: Chapter = { id: seriesId, name: "Gallery", number: 1 };
    const posted = $(".pages, .posted")
      .toArray()
      .map((el) => $(el).text().replace(/\s+/g, " ").trim())
      .find((t) => t.startsWith("Posted:"))
      ?.slice("Posted:".length)
      .trim();
    const date = posted ? parseDate(posted) : undefined;
    if (date !== undefined) ch.publishedAt = date;
    const groups = this.infoNames($, "Groups");
    if (groups.length) ch.group = groups.join(", ");
    return [ch];
  }

  override async getChapterPages(seriesId: string, _chapterId: string): Promise<Page[]> {
    const $ = await this.gallery(seriesId);
    const script = $("script").toArray().map((s) => $(s).html() ?? "").find((t) => t.includes("parseJSON"));
    const json = script && /\$\.parseJSON\('([^']+)'\)/.exec(script)?.[1];
    const dir = $("#load_dir").attr("value");
    const loadId = $("#load_id").attr("value");
    if (!json || !dir || !loadId) throw new Error(`${this.cfg.name}: this gallery has no pages to show`);
    const server = $("#load_server").attr("value");
    const coverHost = /^https?:\/\/([^/]+)/.exec(imgSrc($(this.cfg.coverSelector).first()) ?? "")?.[1];
    const host = server ? `m${server}.${this.siteHost}` : coverHost;
    if (!host) throw new Error(`${this.cfg.name}: couldn't tell where this gallery's images are`);
    const list = JSON.parse(json) as Record<string, string>;
    return Object.keys(list)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b)
      .map((n, index) => {
        const ext = EXTENSIONS[list[String(n)]!.split(",")[0]!] ?? "jpg";
        const base = `https://${host}/${dir}/${loadId}/${n}`;
        // Thumbnails are JPEG whatever the page is.
        return { index, imageUrl: `${base}.${ext}`, thumbnail: { kind: "image" as const, url: `${base}t.jpg` } };
      });
  }

  // ── Links ───────────────────────────────────────────────────────────────────

  /** `/gallery/{id}/`, and a reader page (`/g/{id}/{n}/`, `/view/{id}/{n}/`). */
  async resolveUrl(url: string): Promise<LinkTarget | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.hostname.replace(/^www\./, "") !== this.siteHost.replace(/^www\./, "")) return null;
    const m = /^\/(?:gallery|g|view)\/(\d+)(?:\/|$)/.exec(u.pathname);
    return m ? { seriesId: m[1]! } : null;
  }
}

export const galleryAdults = (cfg: GallerySite) => defineBridge((host) => new GalleryAdultsBridge(host, cfg));
