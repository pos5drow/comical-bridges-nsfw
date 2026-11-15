/**
 * Hentai2Read bridge — https://hentai2read.com. The site is an Inertia app: every page embeds its
 * data as JSON (`<script data-page="app" type="application/json">`), so the bridge reads that
 * rather than markup.
 *  - browse: `/browse[/{type}][/{sort}]?page` (`books.data`, paged by `books.lastPage`)
 *  - search: `/search?q&type&sort&page`
 *  - details + chapters: the series page (`/{type}/{id}-{slug}`: `book`, `chapters`)
 *  - pages: the reader (`/reader/{id}-{slug}/{chapterId}/page-1`: `images`, every page at once)
 *
 * A series id is its path without the leading slash (`original/74702-…`); a chapter id is the
 * site's chapter id. Images and covers load from hentaicdn.com without a Referer.
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
  type SortOption,
  type TagGroup,
  defineBridge,
  nextPageCursor,
  pageFromCursor,
  seriesGoneMessage,
} from "@comical/sdk";
import { parseAbsoluteDate, parseStatus, standardGuards } from "comical-bridge-kit";
import { guardResponse } from "./core/guarded";

const SITE = "https://hentai2read.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const TYPES: ReadonlyArray<[string, string]> = [
  ["original", "Original"],
  ["doujinshi", "Doujinshi"],
  ["imageset", "Image sets"],
];

const SORTS: ReadonlyArray<SortOption> = [
  { key: "latest", label: "Recently updated" },
  { key: "newest", label: "Newest" },
  { key: "most-viewed", label: "Most read" },
  { key: "top-rated", label: "Highest rated" },
  { key: "alphabetical", label: "A to Z" },
  { key: "most-chapters", label: "Most chapters" },
  { key: "most-pages", label: "Most pages" },
];

interface Tag {
  name: string;
  type?: string;
}

interface BookCard {
  id: number;
  title: string;
  url: string;
  cover?: string | null;
  typeLabel?: string;
  chapters?: number;
  pageCount?: number;
  artist?: { name: string } | null;
}

interface Paged {
  data: BookCard[];
  page?: number;
  lastPage?: number;
}

interface Book {
  title: string;
  url: string;
  cover?: string | null;
  alt?: string | null;
  description?: string | null;
  type?: { label: string } | null;
  status?: { label: string } | null;
  tags?: Tag[];
  groups?: { label: string; type: string; tags: Tag[] }[];
}

interface ChapterRow {
  id: number;
  number?: string | null;
  title?: string | null;
  url: string;
  date?: string | null;
  isMembers?: boolean;
}

/** A series path from a site URL or path, or undefined when it isn't one. */
function seriesPath(urlOrPath: string): string | undefined {
  const path = urlOrPath.replace(/^https?:\/\/(?:www\.)?hentai2read\.com/, "").replace(/[?#].*$/, "");
  const m = /^\/((?:original|doujinshi|imageset|video)\/\d+-[^/]+)\/?$/.exec(path);
  return m?.[1];
}

class Hentai2ReadBridge extends BridgeBase {
  readonly info: BridgeInfo = {
    id: "pos5drow.hentai2read",
    name: "Hentai2Read",
    version: "0.1.1",
    contractVersion: "2.1.0",
    languages: ["en"],
    nsfw: true,
    capabilities: ["lists", "search", "filters", "sort"],
    iconUrl: `${SITE}/favicon.ico`,
    rateLimit: { maxConcurrent: 2, minIntervalMs: 500 },
    assetRateLimit: { maxConcurrent: 4, minIntervalMs: 100 },
    linkHosts: ["hentai2read.com"],
  };

  private readonly guards = standardGuards(["hentai2read.com", "hentaicdn.com"]);

  protected override async request(req: Parameters<BridgeBase["request"]>[0]): Promise<HttpResponse> {
    return guardResponse(await super.request(req), this.guards, req);
  }

  /** A page's embedded props. */
  private async props<T>(path: string): Promise<{ component: string; props: T }> {
    const res = await this.request({ url: `${SITE}${path}`, headers: { "User-Agent": UA, Accept: "text/html", Referer: `${SITE}/` } });
    if (res.status === 404) throw new Error(seriesGoneMessage());
    if (res.status >= 400) throw new Error(`Hentai2Read answered HTTP ${res.status} for ${path}`);
    const json = /<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/.exec(res.body)?.[1];
    if (!json) throw new Error("Hentai2Read changed its pages (no page data found); this bridge needs an update");
    const page = JSON.parse(json) as { component: string; props: T };
    if (page.component === "Error") throw new Error(seriesGoneMessage());
    return page;
  }

  private entry(b: BookCard): SeriesEntry | undefined {
    const id = seriesPath(b.url);
    if (!id) return undefined;
    const e: SeriesEntry = { id, title: b.title.trim() };
    if (b.cover) e.thumbnailUrl = b.cover;
    const sub = [b.artist?.name && b.artist.name !== "Unknown" ? b.artist.name : undefined, b.typeLabel].filter(Boolean).join(" · ");
    if (sub) e.subtitle = sub;
    return e;
  }

  private results(books: Paged | undefined, page: number): PagedResults<SeriesEntry> {
    const items = (books?.data ?? []).map((b) => this.entry(b)).filter((e): e is SeriesEntry => !!e);
    return { items, nextCursor: nextPageCursor(page, page < (books?.lastPage ?? 1)) };
  }

  // ── Lists & search ──────────────────────────────────────────────────────────

  async getLists(): Promise<SeriesList[]> {
    return [
      { id: "latest", name: "Recently updated", layout: "grid", featured: true },
      { id: "trending", name: "Trending", layout: "grid", featured: true },
      { id: "most-viewed", name: "Most read", layout: "grid" },
      { id: "newest", name: "Newest", layout: "grid" },
    ];
  }

  async getListItems(listId: string, req: ListRequest = {}): Promise<PagedResults<SeriesEntry>> {
    const path = { latest: "/browse", trending: "/browse/trending", "most-viewed": "/browse/most-viewed", newest: "/browse/newest" }[listId];
    if (!path) throw new Error(`unknown list: ${listId}`);
    const page = pageFromCursor(req.cursor);
    const { props } = await this.props<{ books?: Paged }>(page > 1 ? `${path}?page=${page}` : path);
    return this.results(props.books, page);
  }

  async getFilters(): Promise<Filter[]> {
    return [
      { type: "select", key: "type", label: "Type", options: TYPES.map(([value, label]) => ({ value, label })) },
      { type: "select", key: "status", label: "Status", options: [{ value: "ongoing", label: "Ongoing" }, { value: "completed", label: "Completed" }] },
    ];
  }

  async getSortOptions(): Promise<SortOption[]> {
    return [...SORTS];
  }

  async getSearchResults(req: SearchRequest): Promise<PagedResults<SeriesEntry>> {
    const page = pageFromCursor(req.cursor);
    const q = new URLSearchParams({ q: req.text.trim() });
    for (const f of req.filters ?? []) {
      if ((f.key === "type" || f.key === "status") && typeof f.value === "string" && f.value) q.set(f.key, f.value);
    }
    if (req.sort) q.set("sort", req.sort.key);
    if (page > 1) q.set("page", String(page));
    const { props } = await this.props<{ books?: Paged }>(`/search?${q}`);
    return this.results(props.books, page);
  }

  // ── Details, chapters, pages ────────────────────────────────────────────────

  private series(seriesId: string) {
    if (!seriesPath(`/${seriesId}`)) throw new Error(seriesGoneMessage());
    return this.props<{ book: Book; chapters?: ChapterRow[] }>(`/${seriesId}`);
  }

  async getSeriesDetails(seriesId: string): Promise<SeriesInfo> {
    const { props } = await this.series(seriesId);
    const b = props.book;
    const info: SeriesInfo = { id: seriesId, title: b.title.trim(), shareUrl: `${SITE}/${seriesId}` };
    if (b.cover) info.thumbnailUrl = b.cover;
    if (b.alt?.trim() && b.alt.trim() !== info.title) info.altTitles = [b.alt.trim()];
    if (b.description?.trim()) info.description = b.description.trim();
    const status = parseStatus(b.status?.label);
    if (status !== "unknown") info.status = status;
    if (b.type?.label) info.type = b.type.label;
    const byType = (type: string) => (b.tags ?? []).filter((t) => t.type === type).map((t) => t.name);
    const groups: TagGroup[] = [];
    const add = (label: string, kind: TagGroup["kind"], tags: string[]) => {
      if (tags.length) groups.push({ label, kind, tags: [...new Set(tags)] });
    };
    add("Categories", "genre", byType("category"));
    add("Content", "content-warning", byType("content"));
    for (const g of b.groups ?? []) {
      const names = g.tags.map((t) => t.name).filter((n) => n && n !== "Unknown");
      if (g.type === "artist" || g.type === "author") {
        if (names.length) {
          info.authors = names.map((name) => ({ name }));
          info.author = names.join(", ");
        }
      } else add(g.label, "other", names);
    }
    if (groups.length) info.tagGroups = groups;
    return info;
  }

  override async getChapters(seriesId: string): Promise<Chapter[]> {
    const { props } = await this.series(seriesId);
    return (props.chapters ?? [])
      .filter((c) => !c.isMembers)
      .map((c) => {
        const ch: Chapter = { id: String(c.id), name: c.title?.trim() || `Chapter ${c.number ?? ""}`.trim() };
        const n = Number(c.number);
        if (c.number && Number.isFinite(n)) ch.number = n;
        const date = c.date ? parseAbsoluteDate(c.date) : undefined;
        if (date !== undefined) ch.publishedAt = date;
        return ch;
      });
  }

  override async getChapterPages(seriesId: string, chapterId: string): Promise<Page[]> {
    const slug = seriesPath(`/${seriesId}`)?.split("/")[1];
    if (!slug || !/^\d+$/.test(chapterId)) throw new Error(seriesGoneMessage("chapter removed from the source"));
    const { props } = await this.props<{ images?: string[] }>(`/reader/${slug}/${chapterId}/page-1`);
    const images = (props.images ?? []).filter((u) => /^https?:\/\//.test(u));
    if (images.length === 0) throw new Error("Hentai2Read: this chapter has no pages to show (it may be for members only)");
    return images.map((imageUrl, index) => ({ index, imageUrl }));
  }

  // ── Links ───────────────────────────────────────────────────────────────────

  /** Series pages directly; a reader link names the series by its `{id}-{slug}` alone, so it is looked up. */
  async resolveUrl(url: string): Promise<LinkTarget | null> {
    const direct = seriesPath(url);
    if (direct) return { seriesId: direct };
    const m = /^https?:\/\/(?:www\.)?hentai2read\.com\/reader\/(\d+-[^/]+)\/(\d+)/.exec(url);
    if (!m) return null;
    const { props } = await this.props<{ book?: { url: string } }>(`/reader/${m[1]}/${m[2]}/page-1`);
    const id = props.book ? seriesPath(props.book.url) : undefined;
    return id ? { seriesId: id, chapterId: m[2]! } : null;
  }
}

export default defineBridge((host) => new Hentai2ReadBridge(host));
