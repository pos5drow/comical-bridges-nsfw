/**
 * Hentai2Read against its pages' embedded data (Nov 2026), reduced to one series chosen for tame
 * tags: browse and search paging, details from `book`, chapters, reader images, and links.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import { nextPageCursor } from "@comical/sdk";
import hentai2read from "../src/hentai2read.ts";

const ID = "original/74702-aku-no-onna-kanbu-seigi-ochi-villian-cattle";
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "hentai2read", name), "utf8");

function host(over?: (url: string) => HttpResponse | undefined) {
  const requests: string[] = [];
  const caps: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        requests.push(req.url);
        const hit = over?.(req.url);
        if (hit) return hit;
        const p = new URL(req.url).pathname;
        const body =
          p.startsWith("/browse") ? fixture("browse.html")
          : p === "/search" ? fixture("search.html")
          : p.startsWith("/reader/") ? fixture("reader.html")
          : fixture("series.html");
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
  return { caps, requests };
}

describe("lists and search", () => {
  test("browse: cards from the page data, paging by lastPage", async () => {
    const { caps, requests } = host();
    const bridge = hentai2read(caps);
    const res = await bridge.getListItems!("latest");
    await bridge.getListItems!("trending", { cursor: nextPageCursor(1, true)! });
    expect(requests).toEqual(["https://hentai2read.com/browse", "https://hentai2read.com/browse/trending?page=2"]);
    expect(res.items[0]).toMatchObject({ id: ID, title: "Aku No Onna Kanbu Seigi Ochi Villian Cattle", subtitle: "Original" });
    expect(res.items[0]!.thumbnailUrl).toStartWith("https://hentaicdn.com/");
    expect(res.nextCursor).toBeDefined();
    expect(bridge.info.nsfw).toBe(true);
  });

  test("search: query, type, status, sort; last page has no cursor", async () => {
    const { caps, requests } = host();
    const res = await hentai2read(caps).getSearchResults!({
      text: "villian",
      filters: [{ key: "type", value: "original" }, { key: "status", value: "ongoing" }],
      sort: { key: "top-rated", ascending: false },
    });
    expect(Object.fromEntries(new URL(requests[0]!).searchParams)).toEqual({ q: "villian", type: "original", status: "ongoing", sort: "top-rated" });
    expect(res.items.map((e) => e.id)).toEqual([ID]);
    expect(res.nextCursor).toBeUndefined();
  });
});

describe("details, chapters, pages", () => {
  test("details: tags by kind, status, unknown artist left out", async () => {
    const info = await hentai2read(host().caps).getSeriesDetails(ID);
    expect(info).toMatchObject({ id: ID, status: "ongoing", type: "Original", shareUrl: `https://hentai2read.com/${ID}` });
    expect(info.author).toBeUndefined();
    expect(info.tagGroups?.find((g) => g.kind === "genre")?.tags).toEqual(["Adult", "Big Breasts", "Futanari", "Serialized"]);
    expect(info.tagGroups?.find((g) => g.label === "Language")?.tags).toEqual(["English"]);
  });

  test("chapters", async () => {
    const chapters = await hentai2read(host().caps).getChapters!(ID);
    expect(chapters).toEqual([{ id: "118202", name: "Aku No Onna Kanbu Seigi Ochi Villian Cattle", number: 1, publishedAt: Date.UTC(2026, 10, 8) }]);
  });

  test("pages: every image from the reader's first page", async () => {
    const { caps, requests } = host();
    const pages = await hentai2read(caps).getChapterPages!(ID, "118202");
    expect(requests[0]).toBe("https://hentai2read.com/reader/74702-aku-no-onna-kanbu-seigi-ochi-villian-cattle/118202/page-1");
    expect(pages[0]).toEqual({ index: 0, imageUrl: "https://hentaicdn.com/hentai/up/74702/c118202-vbmmuw/0001.webp" });
    expect(pages).toHaveLength(3);
  });

  test("a missing series is gone", async () => {
    const { caps } = host((u) => (u.endsWith("/original/1-x") ? { url: u, status: 404, statusText: "", headers: {}, body: "" } : undefined));
    await expect(hentai2read(caps).getSeriesDetails("original/1-x")).rejects.toThrow(/removed from the source/);
    await expect(hentai2read(caps).getSeriesDetails("../etc")).rejects.toThrow(/removed from the source/);
  });
});

test("links: series directly, a reader link through its book", async () => {
  const { caps, requests } = host();
  const bridge = hentai2read(caps);
  expect(await bridge.resolveUrl!(`https://hentai2read.com/${ID}`)).toEqual({ seriesId: ID });
  expect(requests).toEqual([]);
  expect(await bridge.resolveUrl!("https://hentai2read.com/reader/74702-aku-no-onna-kanbu-seigi-ochi-villian-cattle/118202/page-3")).toEqual({ seriesId: ID, chapterId: "118202" });
  expect(await bridge.resolveUrl!("https://hentai2read.com/browse")).toBeNull();
});
