/**
 * wnacg (紳士漫畫) bridge — Chinese, server-rendered on rotating mirrors (picked in settings):
 *  - lists: weekly ranking (`/albums-favorite_ranking-page-{n}-type-{period}.html`), latest
 *    (`/albums-index-page-{n}.html`), and a category or tag (`…-cate-{id}.html`, `…-tag-{tag}.html`)
 *  - search: `/search/index.php?s={sort}&q&p` (categories and tags don't combine with a query)
 *  - details: `/photos-index-aid-{aid}.html`; a collection lists its chapters there (paged),
 *    a single gallery is its own one chapter
 *  - pages: `/photos-gallery-aid-{aid}.html`, a script whose image URLs (with an expiring
 *    `verify` token) are read out by pattern
 *
 * Series and chapter ids are album ids (`aid`). Some categories need a signed-in account and
 * aren't offered; the photo and cosplay category is left out on purpose (it is real people, not
 * drawn work). Images load without a Referer.
 */
import {
  BridgeBase,
  type BridgeInfo,
  type Chapter,
  type CheerioRoot,
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
import { parseAbsoluteDate, standardGuards } from "comical-bridge-kit";
import { guardResponse } from "./core/guarded";
import { bridgeIcon } from "./core/icon";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const MIRRORS = ["https://www.wnacg.buzz", "https://www.wnacg.site"];

const SORTS: ReadonlyArray<SortOption> = [
  { key: "create_time_DESC", label: "最新" },
  { key: "heat_day_DESC", label: "今日熱門" },
  { key: "heat_week_DESC", label: "本週熱門" },
  { key: "heat_month_DESC", label: "本月熱門" },
  { key: "heat_year_DESC", label: "今年熱門" },
];

/** Category ids, drawn work only (the photo/cosplay category, 3, is left out on purpose). */
const CATEGORIES: ReadonlyArray<[string, string]> = [
  ["5", "同人誌"], ["1", "同人誌-漢化"], ["12", "同人誌-日語"], ["16", "同人誌-English"], ["2", "同人誌-CG書籍"],
  ["6", "單行本"], ["9", "單行本-漢化"], ["17", "單行本-English"], ["13", "單行本-日語"],
  ["7", "雜誌&短篇"], ["10", "雜誌&短篇-漢語"], ["14", "雜誌&短篇-日語"], ["18", "雜誌&短篇-English"],
  ["22", "3D&漫畫"], ["23", "3D&漫畫-漢語"], ["24", "3D&漫畫-其他"],
];

const IMAGE = /\/\/[^\s"'\\]+\.(?:jpeg|jpg|png|webp|gif)(?:\?[^\s"'\\]*)?/gi;

/** Protocol-relative image URLs, some with extra leading slashes. */
const imageUrl = (src: string) => `https://${src.replace(/^\/+/, "")}`;
const aidOf = (href: string) => /photos-(?:index|slide|list|gallery)(?:-page-\d+)?-aid-(\d+)/.exec(href)?.[1];

class WnacgBridge extends BridgeBase {
  readonly info: BridgeInfo = {
    id: "pos5drow.wnacg",
    name: "紳士漫畫 (wnacg)",
    version: "0.1.3",
    contractVersion: "2.1.0",
    languages: ["zh"],
    nsfw: true,
    capabilities: ["lists", "search", "filters", "sort", "settings"],
    iconUrl: bridgeIcon("wnacg"),
    rateLimit: { maxConcurrent: 2, minIntervalMs: 500 },
    assetRateLimit: { maxConcurrent: 4, minIntervalMs: 100 },
    linkHosts: ["wnacg.buzz", "wnacg.site", "wnacg.com"],
  };

  private readonly guards = standardGuards(["wnacg.buzz", "wnacg.site", "wnimg2.cfd"]);

  getSettings(): SettingDescriptor[] {
    return [{ type: "enum", key: "mirror", label: "鏡像站", options: MIRRORS.map((m) => ({ value: m, label: new URL(m).host })), default: MIRRORS[0]! }];
  }

  private get site(): string {
    const v = this.settings["mirror"];
    return typeof v === "string" && MIRRORS.includes(v) ? v : MIRRORS[0]!;
  }

  protected override async request(req: Parameters<BridgeBase["request"]>[0]): Promise<HttpResponse> {
    return guardResponse(await super.request(req), this.guards, req);
  }

  private async body(path: string): Promise<string> {
    const res = await this.request({ url: `${this.site}${path}`, headers: { "User-Agent": UA, Referer: `${this.site}/` } });
    if (res.status === 404) throw new Error(seriesGoneMessage());
    if (res.status >= 400) throw new Error(`wnacg answered HTTP ${res.status} for ${path}`);
    return res.body;
  }

  private async page(path: string): Promise<CheerioRoot> {
    return this.parse(await this.body(path));
  }

  private list($: CheerioRoot, page: number): PagedResults<SeriesEntry> {
    const items: SeriesEntry[] = [];
    const seen = new Set<string>();
    $(".gallary_item").each((_, el) => {
      const $a = $(el).find(".title > a").first();
      const id = aidOf($a.attr("href") ?? "");
      if (!id || seen.has(id)) return;
      seen.add(id);
      const e: SeriesEntry = { id, title: ($a.attr("title") || $a.text()).trim() };
      const img = $(el).find("img").attr("src");
      if (img) e.thumbnailUrl = imageUrl(img);
      const info = $(el).find(".info_col").first().text().replace(/\s+/g, " ").trim();
      const pages = /(\d+)張圖片/.exec(info)?.[1];
      if (pages) e.subtitle = `${pages}P`;
      items.push(e);
    });
    return { items, nextCursor: nextPageCursor(page, $("span.thispage + a").length > 0) };
  }

  // ── Lists & search ──────────────────────────────────────────────────────────

  async getLists(): Promise<SeriesList[]> {
    return [
      { id: "ranking-week", name: "本週排行", layout: "grid", featured: true },
      { id: "latest", name: "最新更新", layout: "grid", featured: true },
      { id: "ranking-month", name: "本月排行", layout: "grid" },
    ];
  }

  async getListItems(listId: string, req: ListRequest = {}): Promise<PagedResults<SeriesEntry>> {
    const page = pageFromCursor(req.cursor);
    const path =
      listId === "latest" ? `/albums-index-page-${page}.html`
      : listId === "ranking-week" ? `/albums-favorite_ranking-page-${page}-type-week.html`
      : listId === "ranking-month" ? `/albums-favorite_ranking-page-${page}-type-month.html`
      : undefined;
    if (!path) throw new Error(`unknown list: ${listId}`);
    return this.list(await this.page(path), page);
  }

  async getFilters(): Promise<Filter[]> {
    return [
      { type: "select", key: "category", label: "分類（不與關鍵詞同用）", options: CATEGORIES.map(([value, label]) => ({ value, label })) },
      { type: "text", key: "tag", label: "標籤（不與關鍵詞同用）" },
    ];
  }

  async getSortOptions(): Promise<SortOption[]> {
    return [...SORTS];
  }

  async getSearchResults(req: SearchRequest): Promise<PagedResults<SeriesEntry>> {
    const page = pageFromCursor(req.cursor);
    const text = req.text.trim();
    const pick = (key: string) => {
      const v = req.filters?.find((f) => f.key === key)?.value;
      return typeof v === "string" ? v.trim() : "";
    };
    let path: string;
    if (text) {
      path = `/search/index.php?${new URLSearchParams({ s: req.sort?.key ?? "create_time_DESC", q: text, p: String(page) })}`;
    } else if (pick("tag")) {
      path = `/albums-index-page-${page}-tag-${encodeURIComponent(pick("tag"))}.html`;
    } else if (CATEGORIES.some(([id]) => id === pick("category"))) {
      path = `/albums-index-page-${page}-cate-${pick("category")}.html`;
    } else {
      path = `/albums-index-page-${page}.html`;
    }
    return this.list(await this.page(path), page);
  }

  // ── Details, chapters, pages ────────────────────────────────────────────────

  private album(aid: string): Promise<CheerioRoot> {
    if (!/^\d+$/.test(aid)) throw new Error(seriesGoneMessage());
    return this.page(`/photos-index-aid-${aid}.html`);
  }

  async getSeriesDetails(seriesId: string): Promise<SeriesInfo> {
    const $ = await this.album(seriesId);
    const title = $("h2").first().text().trim();
    if (!title) throw new Error("wnacg: this album doesn't exist or needs a signed-in account");
    const info: SeriesInfo = { id: seriesId, title, shareUrl: `${this.site}/photos-index-aid-${seriesId}.html` };
    const cover = $("div.uwthumb img").attr("src");
    if (cover) info.thumbnailUrl = imageUrl(cover);
    // The uploader, not the author (the site has no author field; artists are usually tags).
    const uploader = $("div.uwuinfo p").first().text().trim();
    const label = (prefix: string) =>
      $("div.uwconn label").toArray().map((l) => $(l).text().trim()).find((t) => t.startsWith(prefix))?.slice(prefix.length).trim();
    const categories = (label("分類：") ?? "").split("／").map((s) => s.trim()).filter(Boolean);
    const tags = $("div.addtags a.tagshow").toArray().map((a) => $(a).text().trim()).filter(Boolean);
    info.tagGroups = [
      ...(categories.length ? [{ label: "分類", kind: "format" as const, tags: categories }] : []),
      ...(tags.length ? [{ label: "標籤", kind: "genre" as const, tags }] : []),
      ...(uploader ? [{ label: "上傳者", kind: "other" as const, tags: [uploader] }] : []),
    ];
    const intro = $("div.uwconn p").toArray().map((p) => $(p).text()).find((t) => t.trim().startsWith("簡介："));
    if (intro?.replace("簡介：", "").trim()) info.description = intro.replace("簡介：", "").trim();
    const chapters = label("章節：");
    info.status = chapters === undefined ? "completed" : (label("狀態") ?? "").includes("連載中") ? "ongoing" : "completed";
    return info;
  }

  override async getChapters(seriesId: string): Promise<Chapter[]> {
    const $ = await this.album(seriesId);
    const rows = (doc: CheerioRoot) =>
      doc("div.sr_compact a.tagshow[data-chid]")
        .toArray()
        .map((a) => ({ id: doc(a).attr("data-chid") ?? "", name: doc(a).text().trim(), title: doc(a).attr("title") ?? "" }));
    const found = rows($);
    if (found.length === 0) {
      // A single gallery: itself, dated from its card.
      const ch: Chapter = { id: seriesId, name: "Ch. 1", number: 1 };
      const date = /\d{4}-\d{2}-\d{2}/.exec($("li.gallary_item .info_col").first().text())?.[0] ?? /創建於(\d{4}-\d{2}-\d{2})/.exec($.html())?.[1];
      const ms = date ? parseAbsoluteDate(date) : undefined;
      if (ms !== undefined) ch.publishedAt = ms;
      return [ch];
    }
    const last = Math.max(
      1,
      ...$("div.f_left.paginator a[href]")
        .toArray()
        .map((a) => Number(/photos-index-aid-\d+-page-(\d+)\.html/.exec($(a).attr("href") ?? "")?.[1] ?? 0)),
    );
    for (let n = 2; n <= Math.min(last, 30); n++) found.push(...rows(await this.page(`/photos-index-aid-${seriesId}-page-${n}.html`)));
    const seen = new Set<string>();
    return found
      .filter((r) => /^\d+$/.test(r.id) && !seen.has(r.id) && !!seen.add(r.id))
      .map((r, i) => {
        const ch: Chapter = { id: r.id, name: r.name || `Ch. ${i + 1}` };
        const date = /\d{4}-\d{2}-\d{2}/.exec(r.title)?.[0];
        const ms = date ? parseAbsoluteDate(date) : undefined;
        if (ms !== undefined) ch.publishedAt = ms;
        return ch;
      })
      .reverse();
  }

  override async getChapterPages(_seriesId: string, chapterId: string): Promise<Page[]> {
    if (!/^\d+$/.test(chapterId)) throw new Error(seriesGoneMessage("chapter removed from the source"));
    const script = await this.body(`/photos-gallery-aid-${chapterId}.html`);
    const urls = [...new Set(script.match(IMAGE) ?? [])].map(imageUrl);
    if (urls.length === 0) throw new Error("wnacg: this album has no pages to show (it may need a signed-in account)");
    return urls.map((url, index) => ({ index, imageUrl: url }));
  }

  // ── Links ───────────────────────────────────────────────────────────────────

  /** Album, reader and chapter links on any mirror; a chapter's `sid` is its collection. */
  async resolveUrl(url: string): Promise<LinkTarget | null> {
    const m = /^https?:\/\/(?:www\.)?wn(?:acg\w*|\d+)\.[a-z]+\/photos-(?:index|slide|list|gallery)(?:-page-\d+)?-aid-(\d+)(?:-sid-(\d+))?/.exec(url);
    if (!m) return null;
    return m[2] ? { seriesId: m[2], chapterId: m[1]! } : { seriesId: m[1]! };
  }
}

export default defineBridge((host) => new WnacgBridge(host));
