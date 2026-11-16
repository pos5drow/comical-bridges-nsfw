/**
 * The galleryadults engine against HentaiFox and IMHentai pages captured Nov 2026 (one gallery each,
 * chosen for tame tags; related galleries and sidebars cut out): language-scoped lists and their
 * paging, both search styles, gallery details, the single chapter, pages from the gallery's JSON on
 * the cover host or the `load_server` shard, and links.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import { nextPageCursor } from "@comical/sdk";
import hentaifox from "../src/hentaifox.ts";
import imhentai from "../src/imhentai.ts";

function host(site: string, settings: Record<string, string> = {}) {
  const requests: string[] = [];
  const caps: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        requests.push(req.url);
        const f = new URL(req.url).pathname.startsWith("/gallery/") ? "gallery.html" : "list.html";
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body: readFileSync(join(import.meta.dir, "fixtures", site, f), "utf8") };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [], secure: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] } },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings,
  };
  return { caps, requests };
}

describe("lists", () => {
  test("HentaiFox: language-scoped, paging by /pag/{n}/, cards once each", async () => {
    const { caps, requests } = host("hentaifox");
    const bridge = hentaifox(caps);
    const res = await bridge.getListItems!("popular");
    await bridge.getListItems!("latest", { cursor: nextPageCursor(1, true)! });
    expect(requests).toEqual(["https://hentaifox.com/language/english/popular/", "https://hentaifox.com/language/english/pag/2/"]);
    expect(res.items).toEqual([{ id: "121667", title: "Shark Eats - ROOKIES", thumbnailUrl: "https://i.hentaifox.com/004/2813091/thumb.jpg" }]);
    expect(res.nextCursor).toBeDefined();
    expect(bridge.info).toMatchObject({ id: "pos5drow.hentaifox", nsfw: true });
  });

  test("IMHentai: every language, paging by ?page", async () => {
    const { caps, requests } = host("imhentai", { language: "all" });
    await imhentai(caps).getListItems!("popular", { cursor: nextPageCursor(1, true)! });
    expect(requests[0]).toBe("https://imhentai.xxx/popular/?page=2");
  });
});

describe("search", () => {
  test("basic: the query with the language appended", async () => {
    const { caps, requests } = host("hentaifox");
    await hentaifox(caps).getSearchResults!({ text: "shark girl", sort: { key: "popular", ascending: false } });
    expect(requests[0]).toBe("https://hentaifox.com/search/?q=shark+girl+english&sort=popular");
  });

  test("flags: sort and one flag per language", async () => {
    const { caps, requests } = host("imhentai", { language: "ja" });
    await imhentai(caps).getSearchResults!({ text: "full color" });
    const q = new URL(requests[0]!).searchParams;
    expect(Object.fromEntries(q)).toEqual({ pp: "0", lt: "1", en: "0", jp: "1", es: "0", fr: "0", kr: "0", de: "0", ru: "0", key: "full color" });
  });

  test("a gallery number opens that gallery", async () => {
    const { caps, requests } = host("hentaifox");
    const res = await hentaifox(caps).getSearchResults!({ text: "121667" });
    expect(requests).toEqual(["https://hentaifox.com/gallery/121667/"]);
    expect(res.items[0]).toMatchObject({ id: "121667", title: "Shark Eats - ROOKIES" });
  });
});

describe("galleries", () => {
  test("HentaiFox details: info lists, cover, page count", async () => {
    const info = await hentaifox(host("hentaifox").caps).getSeriesDetails("121667");
    expect(info).toMatchObject({ title: "Shark Eats - ROOKIES", status: "completed", author: "buta99", thumbnailUrl: "https://i2.hentaifox.com/004/2813091/cover.jpg", description: "22 pages" });
    expect(info.tagGroups?.find((g) => g.kind === "genre")?.tags).toContain("full color");
    expect(info.tagGroups?.find((g) => g.label === "Category")?.tags).toEqual(["doujinshi"]);
  });

  test("IMHentai details: the tags_text layout, badges stripped", async () => {
    const info = await imhentai(host("imhentai").caps).getSeriesDetails("1738938");
    expect(info).toMatchObject({ title: "Artist - EchoSaber", thumbnailUrl: "https://m11.imhentai.xxx/033/iy63wavsu0/cover.jpg" });
    expect(info.tagGroups?.find((g) => g.kind === "genre")?.tags).toContain("big breasts");
    expect(info.tagGroups?.flatMap((g) => g.tags).every((t) => !/\d{3,}/.test(t))).toBe(true);
  });

  test("read directly: no chapters, pages straight from the gallery", async () => {
    const bridge = hentaifox(host("hentaifox").caps);
    expect(bridge.info.capabilities).toContain("direct");
  });

  test("pages on the cover's host (HentaiFox)", async () => {
    const pages = await hentaifox(host("hentaifox").caps).getSeriesPages!("121667");
    expect(pages).toHaveLength(22);
    expect(pages[0]).toEqual({ index: 0, imageUrl: "https://i2.hentaifox.com/004/2813091/1.jpg", thumbnail: { kind: "image", url: "https://i2.hentaifox.com/004/2813091/1t.jpg" } });
  });

  test("pages on the load_server shard, extension from the JSON (IMHentai)", async () => {
    const pages = await imhentai(host("imhentai").caps).getSeriesPages!("1738938");
    expect(pages).toHaveLength(1425);
    expect(pages[0]!.imageUrl).toBe("https://m11.imhentai.xxx/033/iy63wavsu0/1.webp");
    expect(pages[0]!.thumbnail).toEqual({ kind: "image", url: "https://m11.imhentai.xxx/033/iy63wavsu0/1t.jpg" });
    expect(pages.at(-1)!.imageUrl).toEndWith("/1425.webp");
  });
});

test("links: gallery and reader pages", async () => {
  const fox = hentaifox(host("hentaifox").caps);
  expect(await fox.resolveUrl!("https://hentaifox.com/gallery/121667/")).toEqual({ seriesId: "121667" });
  expect(await fox.resolveUrl!("https://hentaifox.com/g/121667/3/")).toEqual({ seriesId: "121667" });
  expect(await fox.resolveUrl!("https://imhentai.xxx/gallery/1/")).toBeNull();
  expect(await imhentai(host("imhentai").caps).resolveUrl!("https://imhentai.xxx/view/1738938/1/")).toEqual({ seriesId: "1738938" });
});
