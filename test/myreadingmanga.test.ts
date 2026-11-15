/**
 * MyReadingManga against its pages as a browser saw them (Nov 2026), cut down to vetted cards:
 * `/lang/english/` (latest, with a video post to skip), an ElasticPress search, and one single-part
 * post (bara, adult characters) with its related-posts block removed.
 *
 * No multi-part post was captured, so the parts logic runs on that post with a synthetic
 * `entry-pagination` block spliced in, written the way the site draws it under multi-part cards
 * (`1 2 3 4 … 12 13 14 »`), along with synthetic lazy `div.separator` images.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bridgeInfoSchema, type HostCapabilities, type HttpRequest, type HttpResponse, type SettingValue } from "@comical/contract";
import { nextPageCursor } from "@comical/sdk";
import myreadingmanga, { cleanTitle, parsePostLink } from "../src/myreadingmanga.ts";

const ID = "redgart-daze-part-2-street-fighter-6-dj-eng";
const POST = `https://myreadingmanga.info/${ID}/`;
const IMG = "https://i6.myreadingmanga.info/images/2026/10/26";
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "myreadingmanga", name), "utf8");

const PAGINATION =
  `<div class="entry-pagination pagination"><span aria-current="page" class="page-numbers current">1</span>\n` +
  [2, 3, 4].map((n) => `<a class="page-numbers" href="${POST}${n}/">${n}</a>\n`).join("") +
  `<span class="page-numbers dots">&hellip;</span>\n` +
  [12, 13, 14].map((n) => `<a class="page-numbers" href="${POST}${n}/">${n}</a>\n`).join("") +
  `<a class="next page-numbers" href="${POST}2/"> » </a></div>`;

/** The post as a multi-part one: a synopsis, a stats line, lazy separator images (one a repeat), and the parts' pagination. */
function multiPart(): string {
  return fixture("post.html").replace(
    '<div class="bookmark" id="bottom">',
    `<div class="entry-content"><p>Two rivals meet again.</p><p>Pages: 20 | Size: 30MB</p>` +
      `<div class="separator"><img src="data:image/gif;base64,R0lGOD" data-src="${IMG}/DAZE-33.webp"></div>` +
      `<div class="separator"><img data-src="${IMG}/DAZE-19.webp"></div>` +
      `<div class="separator"><img src="/x.gif" data-lazy-src="${IMG}/DAZE-34"></div>` +
      `${PAGINATION}</div><div class="bookmark" id="bottom">`,
  );
}

function host(opts: { settings?: Record<string, SettingValue>; userAgent?: string; route?: (url: string) => HttpResponse | undefined } = {}) {
  const requests: HttpRequest[] = [];
  const caps: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        requests.push(req);
        const hit = opts.route?.(req.url);
        if (hit) return hit;
        const u = new URL(req.url);
        const body = u.searchParams.has("s") ? fixture("search.html") : u.pathname.startsWith("/lang/") || u.pathname === "/" || u.pathname.startsWith("/page/") ? fixture("latest.html") : fixture("post.html");
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: {
      get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [],
      secure: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: opts.settings ?? {},
    ...(opts.userAgent ? { getDefaultUserAgent: () => opts.userAgent! } : {}),
  };
  return { caps, requests, urls: () => requests.map((r) => r.url) };
}

const ok = (url: string, body: string): HttpResponse => ({ url, status: 200, statusText: "OK", headers: {}, body });

test("info parses under the contract", () => {
  const info = myreadingmanga(host().caps).info;
  expect(bridgeInfoSchema.parse(info)).toBeTruthy();
  expect(info).toMatchObject({ id: "pos5drow.myreadingmanga", nsfw: true, languages: ["multi"], linkHosts: ["myreadingmanga.info"] });
});

describe("lists and search", () => {
  test("latest: English archive, video posts skipped, cleaned titles, full-size covers, next page", async () => {
    const { caps, urls } = host();
    const bridge = myreadingmanga(caps);
    const res = await bridge.getListItems!("latest");
    await bridge.getListItems!("latest", { cursor: nextPageCursor(1, true)! });
    expect(urls()).toEqual(["https://myreadingmanga.info/lang/english/", "https://myreadingmanga.info/lang/english/page/2/"]);
    expect(res.items.map((e) => e.id)).toEqual([
      "ge-sheng-training-the-guardian-knight-eng-goonet",
      ID,
      "toako-i-want-to-protect-my-favorite-character-from-the-bl-world-eng",
      "dog-house-inugami-ryu-soloexplorer-eng",
    ]);
    expect(res.items[0]).toEqual({
      id: "ge-sheng-training-the-guardian-knight-eng-goonet",
      title: "Training the Guardian Knight",
      subtitle: "Ge Sheng",
      thumbnailUrl: "https://myreadingmanga.info/wp-content/uploads/2026/11/1gk.webp",
    });
    expect(res.items[1]!.title).toBe("Daze Part 2 – Street Fighter 6 dj");
    expect(res.items[2]).toMatchObject({ title: "I want to protect my favorite character from the BL world", subtitle: "Toako · update c.13" });
    expect(res.items[3]).toMatchObject({ title: "SOLOEXPLORER", subtitle: "Dog House (Inugami Ryu)" });
    expect(res.nextCursor).toBeDefined();
  });

  test("latest follows the language setting; every language is the home page", async () => {
    const jp = host({ settings: { language: "jp" } });
    await myreadingmanga(jp.caps).getListItems!("latest");
    const all = host({ settings: { language: "all" } });
    await myreadingmanga(all.caps).getListItems!("latest", { cursor: nextPageCursor(1, true)! });
    expect([...jp.urls(), ...all.urls()]).toEqual(["https://myreadingmanga.info/lang/jp/", "https://myreadingmanga.info/page/2/"]);
  });

  test("random: the search sorted at random", async () => {
    const { caps, urls } = host();
    await myreadingmanga(caps).getListItems!("random");
    expect(urls()).toEqual(["https://myreadingmanga.info/page/1/?s=&ep_sort=rand&ep_filter_lang=english"]);
  });

  test("search: text, sort, language and facet filters; video skipped; next page", async () => {
    const { caps, urls } = host();
    const res = await myreadingmanga(caps).getSearchResults!({
      text: "office",
      filters: [{ key: "genre", value: "bara" }, { key: "status", value: "completed" }, { key: "language", value: "jp" }],
      sort: { key: "date", ascending: false },
    });
    const u = new URL(urls()[0]!);
    expect(u.pathname).toBe("/page/1/");
    expect(Object.fromEntries(u.searchParams)).toEqual({ s: "office", ep_sort: "date", ep_filter_lang: "jp", ep_filter_genre: "bara", ep_filter_status: "completed" });
    expect(res.items.map((e) => e.title)).toEqual(["Koi wo Shitai Wake Janai Keredo – Vol.01", "Caught in the Office", "Tonari no Douki no Renai Jijou"]);
    expect(res.items[0]!.subtitle).toBe("SHINOZAKI Mai · update c.Extra 5");
    expect(res.nextCursor).toBeDefined();
  });

  test("search: defaults, oldest first, page 2, and tag-chip tokens", async () => {
    const { caps, urls } = host({ settings: { language: "all" } });
    const bridge = myreadingmanga(caps);
    await bridge.getSearchResults!({ text: "office" });
    await bridge.getSearchResults!({ text: "", sort: { key: "date", ascending: true }, cursor: nextPageCursor(1, true)! });
    await bridge.getSearchResults!({ text: "genre:bara tag:hairy tag:western lang:english" });
    const params = urls().map((x) => [new URL(x).pathname, Object.fromEntries(new URL(x).searchParams)]);
    expect(params).toEqual([
      ["/page/1/", { s: "office", ep_sort: "relevance" }],
      ["/page/2/", { s: "", ep_sort: "date_asc" }],
      ["/page/1/", { s: "", ep_sort: "date", ep_filter_lang: "english", ep_filter_genre: "bara", ep_filter_post_tag: "hairy,western" }],
    ]);
  });

  test("the host's browser User-Agent is used; otherwise a browser fallback", async () => {
    const real = host({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15" });
    await myreadingmanga(real.caps).getListItems!("latest");
    const odd = host({ userAgent: "okhttp/4.12" });
    await myreadingmanga(odd.caps).getListItems!("latest");
    expect(real.requests[0]!.headers!["User-Agent"]).toStartWith("Mozilla/5.0 (iPhone");
    expect(odd.requests[0]!.headers!["User-Agent"]).toStartWith("Mozilla/5.0 (Windows NT 10.0");
  });
});

describe("details, parts, pages", () => {
  test("details: cleaned title, creator, tag groups with search tokens, cover, language, direction", async () => {
    const { caps, urls } = host();
    const info = await myreadingmanga(caps).getSeriesDetails(ID);
    expect(urls()).toEqual([POST]);
    expect(info).toMatchObject({
      id: ID,
      title: "Daze Part 2 – Street Fighter 6 dj",
      altTitles: ["[Redgart] Daze Part 2 – Street Fighter 6 dj [Eng]"],
      author: "Redgart",
      authors: [{ name: "Redgart" }],
      thumbnailUrl: "https://myreadingmanga.info/wp-content/uploads/2026/10/DAZE-00-cover.webp",
      languages: ["en"],
      readingDirection: "ltr",
      shareUrl: POST,
    });
    expect(info.status).toBeUndefined();
    expect(info.description).toBeUndefined();
    const group = (label: string) => info.tagGroups?.find((g) => g.label === label);
    expect(group("Genres")).toEqual({ label: "Genres", kind: "genre", tags: ["Bara/ Muscle", "Yaoi"], tagQueries: ["genre:bara", "genre:yaoi"] });
    expect(group("Category")).toEqual({ label: "Category", kind: "format", tags: ["Street Fighter"], tagQueries: ["category:street-fighter-dj"] });
    expect(group("Tags")?.tags).toEqual(["Big Breasts", "Big Penis", "Blowjob", "Hairy", "Hardcore", "Uncensored", "Western"]);
    expect(group("Tags")?.tagQueries?.[0]).toBe("tag:big-breasts");
    expect(group("Creator")?.tagQueries).toEqual(["artist:redgart"]);
    expect(group("Language")?.tagQueries).toEqual(["lang:english"]);
  });

  test("details: synopsis paragraphs (stats lines left out)", async () => {
    const { caps } = host({ route: (u) => (u === POST ? ok(u, multiPart()) : undefined) });
    const info = await myreadingmanga(caps).getSeriesDetails(ID);
    expect(info.description).toBe("Two rivals meet again.");
  });

  test("parts: a single-part post is one chapter", async () => {
    const chapters = await myreadingmanga(host().caps).getChapters!(ID);
    expect(chapters).toEqual([{ id: "1", name: "Part 1", number: 1, publishedAt: Date.parse("2026-11-15T17:00:25+00:00"), languageCode: "en" }]);
  });

  test("parts: the pagination's last number, hidden parts included, newest first", async () => {
    const { caps } = host({ route: (u) => (u === POST ? ok(u, multiPart()) : undefined) });
    const chapters = await myreadingmanga(caps).getChapters!(ID);
    expect(chapters.map((c) => c.id)).toEqual(["14", "13", "12", "11", "10", "9", "8", "7", "6", "5", "4", "3", "2", "1"]);
    expect(chapters[0]).toMatchObject({ name: "Part 14", number: 14 });
  });

  test("pages: the content's images in order, banners left out", async () => {
    const { caps, urls } = host();
    const pages = await myreadingmanga(caps).getChapterPages!(ID, "1");
    expect(urls()).toEqual([POST]);
    expect(pages[0]).toEqual({ index: 0, imageUrl: `${IMG}/DAZE-00-cover.webp` });
    expect(pages[1]!.imageUrl).toBe(`${IMG}/DAZE-16-ing.webp`);
    expect(pages.at(-1)!.imageUrl).toBe(`${IMG}/DAZE-32-ing.webp`);
    expect(pages).toHaveLength(18);
    expect(pages.some((p) => p.imageUrl.includes("wp-content"))).toBe(false);
  });

  test("pages: a later part's own page; lazy separator images, de-duplicated", async () => {
    const { caps, urls } = host({ route: (u) => (u === `${POST}3/` ? ok(u, multiPart()) : undefined) });
    const pages = await myreadingmanga(caps).getChapterPages!(ID, "3");
    expect(urls()).toEqual([`${POST}3/`]);
    const list = pages.map((p) => p.imageUrl);
    expect(list.slice(-2)).toEqual([`${IMG}/DAZE-33.webp`, `${IMG}/DAZE-34`]);
    expect(list.filter((u) => u.endsWith("/DAZE-19.webp"))).toHaveLength(1);
    expect(pages).toHaveLength(20);
    expect(pages.map((p) => p.index)).toEqual([...pages.keys()]);
  });

  test("a removed post is gone; a bad id or part never reaches the site", async () => {
    const { caps, urls } = host({ route: (u) => (u.includes("/gone-post/") ? { url: u, status: 404, statusText: "", headers: {}, body: "" } : undefined) });
    const bridge = myreadingmanga(caps);
    await expect(bridge.getSeriesDetails("gone-post")).rejects.toThrow(/removed from the source/);
    await expect(bridge.getSeriesDetails("../etc")).rejects.toThrow(/removed from the source/);
    await expect(bridge.getChapterPages!(ID, "0")).rejects.toThrow(/removed from the source/);
    expect(urls()).toEqual(["https://myreadingmanga.info/gone-post/"]);
  });

  test("a listing page isn't a post", async () => {
    const { caps } = host({ route: (u) => (u.endsWith("/street-fighter-dj/") ? ok(u, fixture("latest.html")) : undefined) });
    await expect(myreadingmanga(caps).getSeriesDetails("street-fighter-dj")).rejects.toThrow(/not a post/);
  });
});

test("links: posts and their parts, without a request; site sections aren't posts", async () => {
  const { caps, urls } = host();
  const bridge = myreadingmanga(caps);
  expect(await bridge.resolveUrl!(POST)).toEqual({ seriesId: ID });
  expect(await bridge.resolveUrl!(`https://www.myreadingmanga.info/${ID}`)).toEqual({ seriesId: ID });
  expect(await bridge.resolveUrl!(`${POST}3/`)).toEqual({ seriesId: ID, chapterId: "3" });
  expect(await bridge.resolveUrl!(`${POST}1/`)).toEqual({ seriesId: ID });
  expect(await bridge.resolveUrl!("https://myreadingmanga.info/lang/english/")).toBeNull();
  expect(await bridge.resolveUrl!("https://myreadingmanga.info/genre/bara/")).toBeNull();
  expect(await bridge.resolveUrl!("https://myreadingmanga.info/page/2/?s=office")).toBeNull();
  expect(await bridge.resolveUrl!("https://myreadingmanga.info/")).toBeNull();
  expect(await bridge.resolveUrl!(`https://example.com/${ID}/`)).toBeNull();
  expect(urls()).toEqual([]);
  expect(parsePostLink(`${POST}2/`)).toEqual({ seriesId: ID, part: 2 });
});

test("title cleanup keeps what isn't a label", () => {
  expect(cleanTitle("[Ge Sheng] Training the Guardian Knight [Eng] {Goonet}")).toBe("Training the Guardian Knight");
  expect(cleanTitle("[Dog House (Inugami Ryu)] SOLOEXPLORER [Eng]")).toBe("SOLOEXPLORER");
  expect(cleanTitle("[A] Heat (Pairing) [Eng]")).toBe("Heat (Pairing)");
  expect(cleanTitle("[A] Some Title – Vol.01 [Eng] (update c.7-7.2)")).toBe("Some Title – Vol.01");
});
