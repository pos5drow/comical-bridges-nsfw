/**
 * Regression: hitomi gg.js polarity.
 *
 * Page images live on `w1`/`w2` (`a1`/`a2`), chosen by `1 + gg.m(g)`. hitomi rotates gg.js between
 * `var o = 0` with cases setting `o = 1`, and `var o = 1` with cases setting `o = 0`. The bridge used to
 * assume the first shape, so whenever the site flipped to the second every page URL pointed at the
 * wrong subdomain and 404'd — "the pages only load sometimes".
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory, { parseGg, parsePageKey } from "../src/hitomi.ts";

// g = parseInt(last char + previous two, 16): "…" + "01" + "0" → 0x001 = 1; "…" + "02" + "0" → 2.
const H_CASE = "0".repeat(61) + "010";
const H_DEFAULT = "0".repeat(61) + "020";

const GG_DEFAULT_0 = "'use strict';\ngg = { m: function(g) {\nvar o = 0;\nswitch (g) {\ncase 1:\ncase 5:\no = 1; break;\n}\nreturn o;\n},\nb: '1700000000/'\n};";
const GG_DEFAULT_1 = "'use strict';\ngg = { m: function(g) {\nvar o = 1;\nswitch (g) {\ncase 1:\ncase 5:\no = 0; break;\n}\nreturn o;\n},\nb: '1700000000/'\n};";

function host(gg: string): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const ok = (body: string): HttpResponse => ({ url: req.url, status: 200, statusText: "OK", headers: {}, body });
        if (req.url.endsWith("/gg.js")) return ok(gg);
        return ok(
          "var galleryinfo = " +
            JSON.stringify({ id: "1", title: "Subject", files: [{ name: "1.webp", hash: H_CASE }, { name: "2.webp", hash: H_DEFAULT }] }),
        );
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

/** Each page's real URL, as the image route asks the bridge for it. */
async function pageUrls(gg: string): Promise<string[]> {
  const bridge = factory(host(gg));
  const pages = await bridge.getSeriesPages!("1");
  return Promise.all(pages.map(async (p) => (await bridge.interceptImageRequest!(p.imageUrl)).url));
}

describe("hitomi gg.js", () => {
  test("parseGg reads the default and the case value, whichever way round", () => {
    const a = parseGg(GG_DEFAULT_0);
    expect(a.def).toBe(0);
    expect(a.cases.get(1)).toBe(1);
    expect(a.cases.get(5)).toBe(1);
    expect(a.b).toBe("1700000000/");

    const b = parseGg(GG_DEFAULT_1);
    expect(b.def).toBe(1);
    expect(b.cases.get(1)).toBe(0);
    expect(b.cases.has(2)).toBe(false);
  });

  test("page subdomains follow gg.m in the default-0 shape", async () => {
    const [p0, p1] = await pageUrls(GG_DEFAULT_0);
    expect(p0).toStartWith("https://w2."); // case → 1
    expect(p1).toStartWith("https://w1."); // default → 0
  });

  test("page subdomains follow gg.m in the inverted default-1 shape", async () => {
    const [p0, p1] = await pageUrls(GG_DEFAULT_1);
    expect(p0).toStartWith("https://w1."); // case → 0
    expect(p1).toStartWith("https://w2."); // default → 1
    expect(p1).toBe(`https://w2.gold-usergeneratedcontent.net/1700000000/2/${H_DEFAULT}.webp`);
  });
});

describe("hitomi page keys", () => {
  test("pages are emitted as keys that don't depend on gg.js, so they never expire", async () => {
    const a = await factory(host(GG_DEFAULT_0)).getSeriesPages!("1");
    const b = await factory(host(GG_DEFAULT_1)).getSeriesPages!("1");
    expect(a.map((p) => p.imageUrl)).toEqual(b.map((p) => p.imageUrl));
    expect(a[1]!.imageUrl).toBe(`https://w1.gold-usergeneratedcontent.net/${H_DEFAULT}.webp`);
    expect(parsePageKey(a[1]!.imageUrl)).toEqual({ hash: H_DEFAULT, ext: "webp" });
  });

  test("the interceptor refuses anything that isn't a page key", async () => {
    const bridge = factory(host(GG_DEFAULT_0));
    expect(parsePageKey(`https://w2.gold-usergeneratedcontent.net/${H_DEFAULT}.webp`)).toBeUndefined();
    expect(parsePageKey(`https://w1.gold-usergeneratedcontent.net/1700000000/2/${H_DEFAULT}.webp`)).toBeUndefined();
    await expect(bridge.interceptImageRequest!("https://tn.gold-usergeneratedcontent.net/a.webp")).rejects.toThrow();
  });

  test("concurrent page lookups share one gg.js fetch", async () => {
    let ggFetches = 0;
    const caps = host(GG_DEFAULT_0);
    const request = caps.network.request;
    caps.network.request = async (req) => {
      if (req.url.endsWith("/gg.js")) ggFetches++;
      return request(req);
    };
    const bridge = factory(caps);
    const pages = await bridge.getSeriesPages!("1");
    await Promise.all(pages.map((p) => bridge.interceptImageRequest!(p.imageUrl)));
    expect(ggFetches).toBe(1);
  });
});
