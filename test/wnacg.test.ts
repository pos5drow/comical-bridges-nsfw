/**
 * wnacg against pages captured Nov 2026 (one album, chosen for tame tags; related albums cut out):
 * lists and paging on the chosen mirror, search and the category/tag fallbacks, details, a single
 * gallery as its own chapter, pages read out of the gallery script, and links on any mirror.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import { nextPageCursor } from "@comical/sdk";
import wnacg from "../src/wnacg.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "wnacg", name), "utf8");

function host(settings: Record<string, string> = {}) {
  const requests: string[] = [];
  const caps: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        requests.push(req.url);
        const p = new URL(req.url).pathname;
        const body = p.startsWith("/photos-gallery-") ? fixture("pages.js") : p.startsWith("/photos-index-") ? fixture("gallery.html") : fixture("list.html");
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [], secure: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] } },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings,
  };
  return { caps, requests };
}

describe("lists and search", () => {
  test("latest on the chosen mirror: cards once each, protocol-relative covers made absolute", async () => {
    const { caps, requests } = host({ mirror: "https://www.wnacg.site" });
    const res = await wnacg(caps).getListItems!("latest");
    expect(requests[0]).toBe("https://www.wnacg.site/albums-index-page-1.html");
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ id: "404882", subtitle: "7P" });
    expect(res.items[0]!.thumbnailUrl).toBe("https://t4.wnimg2.cfd/data/t/4048/82/17947352563324658.webp");
    expect(res.nextCursor).toBeDefined();
  });

  test("ranking pages", async () => {
    const { caps, requests } = host();
    await wnacg(caps).getListItems!("ranking-week", { cursor: nextPageCursor(1, true)! });
    expect(requests[0]).toBe("https://www.wnacg.buzz/albums-favorite_ranking-page-2-type-week.html");
  });

  test("search: a query with sort; without one, a tag, then a category", async () => {
    const { caps, requests } = host();
    const bridge = wnacg(caps);
    await bridge.getSearchResults!({ text: "全彩", sort: { key: "heat_week_DESC", ascending: false } });
    await bridge.getSearchResults!({ text: "", filters: [{ key: "tag", value: "全彩" }, { key: "category", value: "1" }] });
    await bridge.getSearchResults!({ text: "", filters: [{ key: "category", value: "1" }] });
    await bridge.getSearchResults!({ text: "", filters: [{ key: "category", value: "3" }] });
    expect(requests).toEqual([
      "https://www.wnacg.buzz/search/index.php?s=heat_week_DESC&q=%E5%85%A8%E5%BD%A9&p=1",
      "https://www.wnacg.buzz/albums-index-page-1-tag-%E5%85%A8%E5%BD%A9.html",
      "https://www.wnacg.buzz/albums-index-page-1-cate-1.html",
      // The photo/cosplay category isn't offered, so it falls back to latest.
      "https://www.wnacg.buzz/albums-index-page-1.html",
    ]);
  });
});

describe("albums", () => {
  test("details: categories, tags, uploader as its own group, a single gallery completed", async () => {
    const info = await wnacg(host().caps).getSeriesDetails("404882");
    expect(info).toMatchObject({ id: "404882", status: "completed", shareUrl: "https://www.wnacg.buzz/photos-index-aid-404882.html" });
    expect(info.title).toStartWith("[pazzimo]");
    expect(info.thumbnailUrl).toBe("https://t4.wnimg2.cfd/data/t/4048/82/17947352563324658.webp");
    expect(info.tagGroups?.find((g) => g.label === "分類")?.tags).toEqual(["同人誌", "漢化"]);
    expect(info.tagGroups?.find((g) => g.kind === "genre")?.tags).toContain("全彩");
    expect(info.tagGroups?.find((g) => g.label === "上傳者")?.tags).toEqual(["dzsmj"]);
    expect(info.authors).toBeUndefined();
  });

  test("a single gallery is its own chapter", async () => {
    const chapters = await wnacg(host().caps).getChapters!("404882");
    expect(chapters).toEqual([{ id: "404882", name: "Ch. 1", number: 1, publishedAt: Date.UTC(2026, 10, 15) }]);
  });

  test("pages from the gallery script, with their verify tokens", async () => {
    const { caps, requests } = host();
    const pages = await wnacg(caps).getChapterPages!("404882", "404882");
    expect(requests[0]).toBe("https://www.wnacg.buzz/photos-gallery-aid-404882.html");
    expect(pages).toHaveLength(7);
    expect(pages[0]!.imageUrl).toMatch(/^https:\/\/img5\.wnimg2\.cfd\/data\/4048\/82\/000\.webp\?verify=/);
  });
});

test("links on any mirror; a chapter link names its collection", async () => {
  const bridge = wnacg(host().caps);
  expect(await bridge.resolveUrl!("https://www.wnacg.com/photos-index-aid-404882.html")).toEqual({ seriesId: "404882" });
  expect(await bridge.resolveUrl!("https://wn01.uk/photos-slide-aid-5-sid-9.html")).toEqual({ seriesId: "9", chapterId: "5" });
  expect(await bridge.resolveUrl!("https://www.wnacg.buzz/albums-index-page-1.html")).toBeNull();
});
