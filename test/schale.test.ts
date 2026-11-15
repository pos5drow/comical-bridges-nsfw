/**
 * The engine Schale Network and HDoujin share, against Schale Network's open API responses captured
 * Nov 2026 (titles replaced with placeholders, cut to three galleries and three page thumbnails):
 * a browse page and a gallery's details. The token-gated responses (image sets, pages) are
 * synthetic, shaped like the site's reader reads them; there is no token to capture them with.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostCapabilities, HttpRequest, HttpResponse, KeyValueStore } from "@comical/contract";
import { nextPageCursor, parseChallenge, webCheckStorageKey } from "@comical/sdk";
import { pickWidth, searchTerms } from "../src/engines/schale.ts";
import hdoujin from "../src/hdoujin.ts";
import schale from "../src/schalenetwork.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "schale", name), "utf8");
const ID = "27847/8805809c47dd";
const TOKEN_KEY = webCheckStorageKey("clearance");

function memory(seed: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
    keys: async () => [...data.keys()],
  };
}

function host(opts: { token?: string; refuse?: boolean; settings?: Record<string, string> } = {}) {
  const requests: HttpRequest[] = [];
  const secure = memory(opts.token ? { [TOKEN_KEY]: opts.token } : {});
  const caps: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        requests.push(req);
        const u = new URL(req.url);
        const ok = (body: string) => ({ url: req.url, status: 200, statusText: "OK", headers: { "content-type": "application/json" }, body });
        if (u.searchParams.has("crt") && opts.refuse) return { url: req.url, status: 403, statusText: "Forbidden", headers: {}, body: "" };
        if (u.pathname.startsWith("/books/data/")) return ok(fixture("images.json"));
        if (u.pathname.startsWith("/books/detail/")) return ok(req.method === "POST" ? fixture("sets.json") : fixture("detail.json"));
        if (u.pathname.startsWith("/books")) return ok(fixture("books.json"));
        return { url: req.url, status: 404, statusText: "Not Found", headers: {}, body: "" };
      },
    },
    storage: { ...memory(), secure },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: opts.settings ?? {},
  };
  return { caps, requests, secure };
}

describe("browse and search", () => {
  test("lists page through the API, with the site's Origin", async () => {
    const { caps, requests } = host();
    const bridge = schale(caps);
    const res = await bridge.getListItems!("latest");
    expect(res.items.map((e) => e.title)).toEqual(["Gallery A", "Gallery B", "Gallery C"]);
    expect(res.items[0]).toMatchObject({ id: ID, subtitle: "65 pages", thumbnailAspect: 320 / 452 });
    expect(res.items[0]!.thumbnailUrl).toStartWith("https://nozomi.erocdn.net/thumbnail/117223/");
    expect(res.nextCursor).toBe(nextPageCursor(1, true));
    expect(requests[0]!.url).toBe("https://api.schale.network/books?page=1");
    expect(requests[0]!.headers).toMatchObject({ Origin: "https://niyaniya.moe", Referer: "https://niyaniya.moe/" });

    await bridge.getListItems!("popular", { cursor: nextPageCursor(1, true)! });
    await bridge.getListItems!("favorites");
    expect(requests.slice(1).map((r) => r.url)).toEqual(["https://api.schale.network/books/popular?page=2", "https://api.schale.network/books?sort=9&page=1"]);
  });

  test("search sends the site's own terms, category as a sum, and the sort", async () => {
    const { caps, requests } = host();
    await schale(caps).getSearchResults!({
      text: 'missus "x"',
      filters: [
        { key: "category", value: ["2", "4"] },
        { key: "language", value: "english" },
        { key: "tags", value: "milf, -ntr, -gore" },
      ],
      sort: { key: "8" },
    });
    const q = new URL(requests[0]!.url).searchParams;
    expect(q.get("s")).toBe('title:"missus x" language:"^english$" tag:"milf" tag:"-ntr,-gore"');
    expect(q.get("cat")).toBe("6");
    expect(q.get("sort")).toBe("8");
  });

  test("terms for pages, artists and parodies", () => {
    expect(searchTerms("", [{ key: "pages", value: "> 20" }, { key: "artist", value: "someone" }, { key: "parody", value: "" }])).toBe('pages:>20 artist:"someone"');
  });
});

describe("a gallery", () => {
  test("details: artists as authors, tags grouped by namespace, the site's page", async () => {
    const info = await schale(host().caps).getSeriesDetails(ID);
    expect(info).toMatchObject({
      id: ID,
      title: "[Taniguchi Daisuke] Gallery A",
      author: "taniguchi daisuke",
      shareUrl: "https://niyaniya.moe/g/27847/8805809c47dd",
      status: "completed",
      thumbnailAspect: 896 / 1265,
    });
    expect(info.thumbnailUrl).toEndWith("/896.jpg");
    expect(info.tagGroups!.map((g) => g.label)).toEqual(["Tags", "Female", "Mixed", "Language", "Other"]);
    expect(info.tagGroups!.find((g) => g.label === "Female")!.tags).toEqual(["busty", "cunnilingus", "harem", "milf", "paizuri"]);
  });

  test("one chapter, dated", async () => {
    expect(await schale(host().caps).getChapters!(ID)).toEqual([{ id: ID, name: "Gallery", publishedAt: 1794725884605 }]);
  });

  test("pages with the token: the chosen width's set, page thumbnails from the details", async () => {
    const { caps, requests } = host({ token: "tok en" });
    const pages = await schale(caps).getChapterPages!(ID, ID);
    expect(pages.map((p) => p.imageUrl)).toEqual([1, 2, 3].map((n) => `https://nozomi.erocdn.net/data/117223/6ff48f70da20/1280/p${n}.webp`));
    expect(pages[0]!.thumbnail).toEqual({ kind: "image", url: expect.stringMatching(/^https:\/\/nozomi\.erocdn\.net\/thumbnail\/.*\/320\.jpg$/) });
    const gated = requests.filter((r) => r.url.includes("crt="));
    expect(gated.map((r) => `${r.method ?? "GET"} ${r.url}`)).toEqual([
      "POST https://api.schale.network/books/detail/27847/8805809c47dd?crt=tok%20en",
      "GET https://api.schale.network/books/data/27847/8805809c47dd/900003/cc33/1280?crt=tok%20en",
    ]);
  });

  test("no token: a web check of the home page that waits for the site's clearance key", async () => {
    const { caps, requests } = host();
    const err = await schale(caps).getChapterPages!(ID, ID).catch((e: Error) => e);
    expect(parseChallenge((err as Error).message)).toMatchObject({ url: "https://niyaniya.moe/", storage: ["clearance"], userAgent: expect.stringContaining("Mozilla/5.0") });
    expect(requests).toEqual([]);
  });

  test("a refused token is forgotten and asks for a new check", async () => {
    const { caps, secure } = host({ token: "stale", refuse: true });
    const err = await schale(caps).getChapterPages!(ID, ID).catch((e: Error) => e);
    expect(parseChallenge((err as Error).message)?.storage).toEqual(["clearance"]);
    expect(secure.data.has(TOKEN_KEY)).toBe(false);
  });
});

describe("image sets", () => {
  const sets = { "0": { id: 1, key: "a" }, "780": { id: 2, key: "b" }, "1600": { id: 4, key: "d" } };
  test("the chosen width, else the nearest larger, the original, then smaller", () => {
    expect(pickWidth(sets, "780")?.width).toBe("780");
    expect(pickWidth(sets, "1280")?.width).toBe("1600");
    expect(pickWidth({ "0": sets["0"], "780": sets["780"] }, "1280")?.width).toBe("0");
    expect(pickWidth({ "780": sets["780"] }, "1600")?.width).toBe("780");
    expect(pickWidth(sets, "0")?.width).toBe("0");
    expect(pickWidth({}, "1280")).toBeUndefined();
  });
});

describe("the two sites", () => {
  test("each its own API, Origin and link host", async () => {
    const { caps, requests } = host();
    const bridge = hdoujin(caps);
    expect(bridge.info).toMatchObject({ id: "pos5drow.hdoujin", nsfw: true, images: { hosts: ["erocdn.net"], headers: { Origin: "https://hdoujin.org" } } });
    await bridge.getListItems!("latest");
    expect(requests[0]!.url).toBe("https://api.hdoujin.org/books?page=1");
    expect(await bridge.resolveUrl!("https://hdoujin.org/g/243018/a808f67b29a8")).toEqual({ seriesId: "243018/a808f67b29a8" });
    expect(await schale(caps).resolveUrl!("https://hdoujin.org/g/1/ab")).toBeNull();
    expect(await schale(caps).resolveUrl!("https://niyaniya.moe/browse")).toBeNull();
  });
});
