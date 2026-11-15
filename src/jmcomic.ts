/**
 * JMComic (禁漫天堂) bridge — Chinese, the 18comic website on mirrors picked in settings (the site's
 * own pages, not the mobile app's API):
 *  - lists & search: `/albums?o={mr|mv|tf}&page`, `/search/photos?search_query&o&page` (`.list-col` cards)
 *  - details + chapters: `/album/{id}/` (a series lists its episodes; a one-off is its own chapter)
 *  - pages: `/photo/{id}`, every image listed (`img[id^=album_photo_]`, `data-original`)
 *
 * Pages of albums from `scramble_id` (220980) on are cut into horizontal strips stored bottom-up;
 * how many strips comes from the last hex digit of md5(aid + file name). The count rides in
 * `Page.process.context` and `layoutPageImage` reverses the strips (`stripLayout`). GIFs aren't cut.
 *
 * Series and chapter ids are album/photo ids. Covers and pages load without a Referer.
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
  type PageImageLayout,
  type PageImageLayoutRequest,
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
  stripLayout,
} from "@comical/sdk";
import { md5, parseAbsoluteDate, standardGuards } from "comical-bridge-kit";
import { guardResponse } from "./core/guarded";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const MIRRORS = ["https://18comic.ink", "https://18comic.vip", "https://jmcomic-zzz.one", "https://jmcomic-zzz.org"];
const HOSTS = MIRRORS.map((m) => new URL(m).hostname);

/** Albums from this id on have their pages cut into strips. */
const SCRAMBLE_FROM = 220980;

const SORTS: ReadonlyArray<SortOption> = [
  { key: "mr", label: "最新" },
  { key: "mv", label: "最多觀看" },
  { key: "tf", label: "最多愛心" },
  { key: "mp", label: "最多圖片" },
];

/** How many strips a page of album `aid` was cut into (the site's `get_num`). */
export function stripCount(aid: number, file: string): number {
  const modulus = aid >= 421926 ? 8 : aid >= 268850 ? 10 : 0;
  if (modulus === 0) return 10;
  const code = md5(`${aid}${file}`).slice(-1).charCodeAt(0);
  return 2 * (code % modulus) + 2;
}

class JmComicBridge extends BridgeBase {
  readonly info: BridgeInfo = {
    id: "pos5drow.jmcomic",
    name: "禁漫天堂 (JMComic)",
    version: "0.1.2",
    contractVersion: "2.1.0",
    languages: ["zh"],
    nsfw: true,
    capabilities: ["lists", "search", "sort", "settings"],
    iconUrl: `${MIRRORS[0]}/favicon.ico`,
    rateLimit: { maxConcurrent: 2, minIntervalMs: 500 },
    assetRateLimit: { maxConcurrent: 4, minIntervalMs: 100 },
    // No headers: covers and uncut pages load directly; cut pages are routed for their layout.
    images: { hosts: HOSTS, process: { layout: true } },
    linkHosts: HOSTS,
  };

  private readonly guards = standardGuards(HOSTS);

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

  private async page(path: string): Promise<{ $: CheerioRoot; body: string }> {
    const res = await this.request({ url: `${this.site}${path}`, headers: { "User-Agent": UA, Accept: "text/html", Referer: `${this.site}/` } });
    if (res.status === 404) throw new Error(seriesGoneMessage());
    if (res.status >= 400) throw new Error(`JMComic answered HTTP ${res.status} for ${path}`);
    return { $: this.parse(res.body), body: res.body };
  }

  private cards($: CheerioRoot, n: number): PagedResults<SeriesEntry> {
    const seen = new Set<string>();
    const items: SeriesEntry[] = [];
    $(".list-col, .thumb-overlay-albums").each((_, el) => {
      const $a = $(el).find("a[href^='/album/']").first();
      const id = /^\/album\/(\d+)/.exec($a.attr("href") ?? "")?.[1];
      if (!id || seen.has(id)) return;
      seen.add(id);
      const $img = $a.find("img").first();
      const title = ($img.attr("title") || $img.attr("alt") || $(el).find(".video-title").first().text() || id).trim();
      const e: SeriesEntry = { id, title };
      const cover = $img.attr("data-original") || $img.attr("src");
      if (cover && /^https?:/.test(cover) && !cover.includes("blank.jpg")) e.thumbnailUrl = cover;
      items.push(e);
    });
    return { items, nextCursor: nextPageCursor(n, $(".pagination li.active + li a").length > 0) };
  }

  // ── Lists & search ──────────────────────────────────────────────────────────

  async getLists(): Promise<SeriesList[]> {
    return [
      { id: "mr", name: "最新", layout: "grid", featured: true },
      { id: "mv", name: "最多觀看", layout: "grid", featured: true },
      { id: "tf", name: "最多愛心", layout: "grid" },
    ];
  }

  async getListItems(listId: string, req: ListRequest = {}): Promise<PagedResults<SeriesEntry>> {
    if (!SORTS.some((s) => s.key === listId)) throw new Error(`unknown list: ${listId}`);
    const n = pageFromCursor(req.cursor);
    const { $ } = await this.page(`/albums?o=${listId}${n > 1 ? `&page=${n}` : ""}`);
    return this.cards($, n);
  }

  async getSortOptions(): Promise<SortOption[]> {
    return [...SORTS];
  }

  async getSearchResults(req: SearchRequest): Promise<PagedResults<SeriesEntry>> {
    const text = req.text.trim();
    // "JM123456" or a bare number opens that album.
    const jm = /^(?:jm)?(\d{3,})$/i.exec(text)?.[1];
    if (jm) {
      const info = await this.getSeriesDetails(jm);
      const e: SeriesEntry = { id: jm, title: info.title };
      if (info.thumbnailUrl) e.thumbnailUrl = info.thumbnailUrl;
      return { items: [e] };
    }
    const n = pageFromCursor(req.cursor);
    const q = new URLSearchParams({ search_query: text, o: req.sort?.key ?? "mr" });
    if (n > 1) q.set("page", String(n));
    const { $ } = await this.page(`/search/photos?${q}`);
    return this.cards($, n);
  }

  // ── Details, chapters, pages ────────────────────────────────────────────────

  private album(id: string) {
    if (!/^\d+$/.test(id)) throw new Error(seriesGoneMessage());
    return this.page(`/album/${id}/`);
  }

  private names($: CheerioRoot, type: string): string[] {
    return [
      ...new Set(
        $(`span[data-type="${type}"] a`)
          .toArray()
          .map((a) => $(a).text().replace(/\s+/g, " ").trim())
          .filter(Boolean),
      ),
    ];
  }

  async getSeriesDetails(seriesId: string): Promise<SeriesInfo> {
    const { $, body } = await this.album(seriesId);
    const title = $("h1.book-name, h1#book-name").first().text().trim();
    if (!title) throw new Error(seriesGoneMessage());
    const info: SeriesInfo = { id: seriesId, title, shareUrl: `${this.site}/album/${seriesId}/` };
    const cover = new RegExp(`https://[^"'\\s]+/media/albums/${seriesId}\\.jpg[^"'\\s]*`).exec(body)?.[0];
    if (cover) info.thumbnailUrl = cover;
    const authors = this.names($, "author");
    if (authors.length) {
      info.authors = authors.map((name) => ({ name }));
      info.author = authors.join(", ");
    }
    const groups: TagGroup[] = [];
    const add = (label: string, kind: TagGroup["kind"], tags: string[]) => {
      if (tags.length) groups.push({ label, kind, tags });
    };
    add("標籤", "genre", this.names($, "tags"));
    add("作品", "other", this.names($, "works"));
    add("登場人物", "other", this.names($, "actor"));
    if (groups.length) info.tagGroups = groups;
    const desc = $("h2:contains('敘述'), div:contains('敘述：')").last().text().replace(/^[\s\S]*敘述：/, "").trim();
    if (desc) info.description = desc;
    const pages = /頁數:(\d+)/.exec($(".pagecount").first().text())?.[1];
    if (pages && !info.description) info.description = `${pages}P`;
    return info;
  }

  override async getChapters(seriesId: string): Promise<Chapter[]> {
    const { $, body } = await this.album(seriesId);
    const updated = /更新日期\s*:\s*(\d{4}-\d{2}-\d{2})/.exec(body)?.[1];
    const episodes = $(".episode a[href^='/photo/']")
      .toArray()
      .map((a) => ({
        id: /^\/photo\/(\d+)/.exec($(a).attr("href") ?? "")?.[1] ?? "",
        index: Number($(a).attr("data-index") ?? 0),
        name: $(a).find("h3").first().text().replace(/\s+/g, " ").trim(),
        date: /\d{4}-\d{2}-\d{2}/.exec($(a).text())?.[0],
      }))
      .filter((e) => /^\d+$/.test(e.id));
    if (episodes.length === 0) {
      const ch: Chapter = { id: seriesId, name: "Ch. 1", number: 1 };
      const ms = updated ? parseAbsoluteDate(updated) : undefined;
      if (ms !== undefined) ch.publishedAt = ms;
      return [ch];
    }
    const seen = new Set<string>();
    return episodes
      .filter((e) => !seen.has(e.id) && !!seen.add(e.id))
      .sort((a, b) => b.index - a.index)
      .map((e) => {
        const ch: Chapter = { id: e.id, name: e.name || `第${e.index + 1}話`, number: e.index + 1 };
        const ms = e.date ? parseAbsoluteDate(e.date) : undefined;
        if (ms !== undefined) ch.publishedAt = ms;
        return ch;
      });
  }

  override async getChapterPages(_seriesId: string, chapterId: string): Promise<Page[]> {
    if (!/^\d+$/.test(chapterId)) throw new Error(seriesGoneMessage("chapter removed from the source"));
    const { $, body } = await this.page(`/photo/${chapterId}`);
    const aid = Number(/var aid = (\d+);/.exec(body)?.[1] ?? chapterId);
    const scrambleFrom = Number(/var scramble_id = (\d+);/.exec(body)?.[1] ?? SCRAMBLE_FROM);
    const urls = $("img[id^='album_photo_']")
      .toArray()
      .map((img) => $(img).attr("data-original") || $(img).attr("src") || "")
      .filter((u) => /\/media\/photos\//.test(u));
    if (urls.length === 0) throw new Error("JMComic: this chapter has no pages to show");
    return urls.map((imageUrl, index) => {
      const page: Page = { index, imageUrl };
      const file = /\/([^/?#]+?)(?:\.[a-z]+)?(?:[?#].*)?$/i.exec(imageUrl)?.[1] ?? "";
      if (aid >= scrambleFrom && !/\.gif(?:[?#]|$)/i.test(imageUrl) && file) page.process = { context: { strips: String(stripCount(aid, file)) } };
      return page;
    });
  }

  /** Cut pages are stored with their strips bottom-up; put them back in order. */
  async layoutPageImage(req: PageImageLayoutRequest): Promise<PageImageLayout | null> {
    const n = Number(req.context?.["strips"]);
    if (!Number.isInteger(n) || n < 2 || n > 64) return null;
    return stripLayout(req.width, req.height, Array.from({ length: n }, (_, i) => n - 1 - i));
  }

  // ── Links ───────────────────────────────────────────────────────────────────

  async resolveUrl(url: string): Promise<LinkTarget | null> {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (!HOSTS.includes(u.hostname.replace(/^www\./, ""))) return null;
    const album = /^\/album\/(\d+)/.exec(u.pathname)?.[1];
    if (album) return { seriesId: album };
    const photo = /^\/photo\/(\d+)/.exec(u.pathname)?.[1];
    if (!photo) return null;
    // A photo (chapter) page names its series.
    const { body } = await this.page(`/photo/${photo}`);
    const series = /var series_id = (\d+);/.exec(body)?.[1];
    return { seriesId: series && series !== "0" ? series : photo, chapterId: photo };
  }
}

export default defineBridge((host) => new JmComicBridge(host));
