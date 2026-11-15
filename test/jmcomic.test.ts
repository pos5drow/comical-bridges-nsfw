/**
 * JMComic against the 18comic website (Nov 2026), one album chosen for tame tags: lists and paging
 * on the chosen mirror, search (a JM number opens the album), details, the episode list, reader
 * images marked with their strip count, the strip layout, and links. The strip count and layout
 * were checked on real pages: once laid out, each seam is as smooth as any other pair of rows.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import { nextPageCursor } from "@comical/sdk";
import jmcomic, { stripCount } from "../src/jmcomic.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "jmcomic", name), "utf8");

function host(settings: Record<string, string> = {}) {
  const requests: string[] = [];
  const caps: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        requests.push(req.url);
        const p = new URL(req.url).pathname;
        const body = p.startsWith("/photo/") ? fixture("photo.html") : p.startsWith("/album/") ? fixture("album.html") : fixture("list.html");
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [], secure: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] } },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings,
  };
  return { caps, requests };
}

test("strip counts as the site computes them (checked on real pages)", () => {
  expect([stripCount(1490833, "00001"), stripCount(1490833, "00005"), stripCount(1490833, "00010")]).toEqual([14, 2, 4]);
  // Albums between the two thresholds use modulus 10; older ones are always 10 strips.
  expect(stripCount(300000, "00001") % 2).toBe(0);
  expect(stripCount(250000, "00001")).toBe(10);
});

describe("lists and search", () => {
  test("latest on the chosen mirror, cards once each, paging", async () => {
    const { caps, requests } = host({ mirror: "https://18comic.vip" });
    const bridge = jmcomic(caps);
    const res = await bridge.getListItems!("mr");
    await bridge.getListItems!("mv", { cursor: nextPageCursor(1, true)! });
    expect(requests).toEqual(["https://18comic.vip/albums?o=mr", "https://18comic.vip/albums?o=mv&page=2"]);
    expect(res.items).toEqual([{ id: "1490833", title: "极度疯狂", thumbnailUrl: "https://cdn-msp2.18comic.ink/media/albums/1490833_3x4.jpg?u=1794733684" }]);
    expect(res.nextCursor).toBeDefined();
  });

  test("search with sort; a JM number opens that album", async () => {
    const { caps, requests } = host();
    const bridge = jmcomic(caps);
    await bridge.getSearchResults!({ text: "百合", sort: { key: "mv", ascending: false } });
    const jm = await bridge.getSearchResults!({ text: "JM1490833" });
    expect(requests).toEqual(["https://18comic.ink/search/photos?search_query=%E7%99%BE%E5%90%88&o=mv", "https://18comic.ink/album/1490833/"]);
    expect(jm.items[0]).toMatchObject({ id: "1490833", title: "极度疯狂" });
  });
});

describe("albums", () => {
  test("details: tags, author, characters, cover", async () => {
    const info = await jmcomic(host().caps).getSeriesDetails("1490833");
    expect(info).toMatchObject({ id: "1490833", title: "极度疯狂", author: "hongjo", shareUrl: "https://18comic.ink/album/1490833/" });
    expect(info.thumbnailUrl).toStartWith("https://cdn-msp.18comic.ink/media/albums/1490833.jpg");
    expect(info.tagGroups?.find((g) => g.kind === "genre")?.tags).toContain("百合");
    expect(info.tagGroups?.find((g) => g.label === "登場人物")?.tags).toEqual(["姜海朗", "闵珠妍", "车瑞京"]);
  });

  test("episodes, newest first", async () => {
    const chapters = await jmcomic(host().caps).getChapters!("1490833");
    expect(chapters[0]).toMatchObject({ id: "1490833", number: 1 });
    expect(chapters[0]!.name).toContain("第1話");
  });

  test("pages carry their strip count; the layout reverses the strips", async () => {
    const bridge = jmcomic(host().caps);
    const pages = await bridge.getChapterPages!("1490833", "1490833");
    expect(pages.map((p) => [p.imageUrl, p.process?.context?.strips])).toEqual([
      ["https://cdn-msp.18comic.ink/media/photos/1490833/00001.webp", "14"],
      ["https://cdn-msp.18comic.ink/media/photos/1490833/00002.webp", String(stripCount(1490833, "00002"))],
      ["https://cdn-msp.18comic.ink/media/photos/1490833/00003.webp", String(stripCount(1490833, "00003"))],
    ]);
    const layout = await bridge.layoutPageImage!({ url: pages[0]!.imageUrl, width: 874, height: 1596, headers: {}, context: { strips: "2" } });
    // 1596 / 2 = 798: the bottom strip goes on top.
    expect(layout!.ops).toEqual([
      { op: "copy", src: { x: 0, y: 798, w: 874, h: 798 }, dst: { x: 0, y: 0, w: 874, h: 798 } },
      { op: "copy", src: { x: 0, y: 0, w: 874, h: 798 }, dst: { x: 0, y: 798, w: 874, h: 798 } },
    ]);
    expect(await bridge.layoutPageImage!({ url: "x", width: 10, height: 10, headers: {}, context: {} })).toBeNull();
  });
});

test("links on any mirror; a photo link through its series", async () => {
  const { caps, requests } = host();
  const bridge = jmcomic(caps);
  expect(await bridge.resolveUrl!("https://18comic.vip/album/1490833/x")).toEqual({ seriesId: "1490833" });
  expect(requests).toEqual([]);
  expect(await bridge.resolveUrl!("https://jmcomic-zzz.one/photo/1490833")).toEqual({ seriesId: "1490833", chapterId: "1490833" });
  expect(await bridge.resolveUrl!("https://example.com/album/1/")).toBeNull();
});
