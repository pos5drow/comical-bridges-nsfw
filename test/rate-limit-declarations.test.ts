/**
 * The budgets each bridge declares are read by the runtime, not by the bridge, so what matters is
 * that they parse under the contract and resolve the way the bridge means: every API call site of
 * nhentai lands on the per-minute route the spec documents it under, and the thumbnail hosts of
 * hitomi and e-hentai fall in an unlimited group while their page hosts keep the default pacing.
 */
import { describe, expect, test } from "bun:test";
import { bridgeImagePath, bridgeInfoSchema, type HostCapabilities, type RateLimitRoute } from "@comical/contract";
import { assetBudgetFor, compilePathGlob, hostMatches, hostOf, pathOf } from "@comical/core";
import ehentaiFactory from "../src/ehentai.ts";
import hitomiFactory from "../src/hitomi.ts";
import nhentaiFactory from "../src/nhentai.ts";

const host: HostCapabilities = {
  network: { request: async (req) => ({ url: req.url, status: 200, statusText: "OK", headers: {}, body: "" }) },
  storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
  log: { debug() {}, info() {}, warn() {}, error() {} },
  settings: {},
};

function routeFor(routes: RateLimitRoute[], url: string): RateLimitRoute | undefined {
  const h = hostOf(url);
  const p = pathOf(url);
  return routes.find((r) => (r.host === undefined || (h !== undefined && hostMatches(h, r.host.toLowerCase()))) && compilePathGlob(r.match).test(p));
}

describe("declared budgets parse", () => {
  test.each([
    ["nhentai", nhentaiFactory],
    ["hitomi", hitomiFactory],
    ["e-hentai", ehentaiFactory],
  ])("%s", (_name, factory) => {
    expect(() => bridgeInfoSchema.parse(factory(host).info)).not.toThrow();
  });
});

describe("nhentai per-route quotas", () => {
  const routes = nhentaiFactory(host).info.rateLimit!.routes!;
  const api = "https://nhentai.net/api/v2";
  const limitOf = (url: string) => routeFor(routes, url)?.limit;

  test("each call site lands on its documented per-minute limit", () => {
    expect(limitOf(`${api}/search?query=x&sort=popular&page=2`)).toBe(10);
    expect(limitOf(`${api}/galleries/popular`)).toBe(8);
    expect(limitOf(`${api}/galleries?page=1&per_page=24`)).toBe(15);
    expect(limitOf(`${api}/galleries/12345`)).toBe(20);
    expect(limitOf(`${api}/galleries/12345/related`)).toBe(12);
    expect(limitOf(`${api}/galleries/12345/favorite`)).toBe(15);
    expect(limitOf(`${api}/favorites?page=1&per_page=24`)).toBe(15);
    expect(limitOf(`${api}/tags/ids?ids=1,2,3`)).toBe(15);
    expect(limitOf(`${api}/tags/search`)).toBe(30);
    expect(limitOf(`${api}/tags/artists`)).toBe(15);
  });

  test("the CDN config endpoint is unbudgeted", () => {
    expect(routeFor(routes, `${api}/cdn`)).toBeUndefined();
  });

  test("every route window is a minute", () => {
    for (const r of routes) expect(r.windowMs).toBe(60_000);
  });
});

describe("thumbnail hosts are exempt from page pacing", () => {
  test("hitomi: covers off the thumbnail host, pages paced", () => {
    const decl = hitomiFactory(host).info.assetRateLimit;
    const cover = assetBudgetFor(decl, "/img-proxy?url=" + encodeURIComponent("https://tn.gold-usergeneratedcontent.net/webpbigtn/a/b/c.webp"));
    expect(cover?.budget).toEqual({});
    const page = assetBudgetFor(decl, "/img-proxy?url=" + encodeURIComponent("https://w1.gold-usergeneratedcontent.net/1/2/3.webp"));
    expect(page?.budget).toEqual({ maxConcurrent: 3, minIntervalMs: 300 });
    expect(page?.key).not.toBe(cover?.key);
  });

  test("hitomi: the same through the image route", () => {
    const decl = hitomiFactory(host).info.assetRateLimit;
    const cover = bridgeImagePath("pos5drow.hitomi", "https://tn.gold-usergeneratedcontent.net/webpbigtn/a/b/c.webp");
    expect(assetBudgetFor(decl, cover)?.budget).toEqual({});
    const page = bridgeImagePath("pos5drow.hitomi", `https://w1.gold-usergeneratedcontent.net/${"0".repeat(64)}.webp`);
    expect(assetBudgetFor(decl, page)?.budget).toEqual({ maxConcurrent: 3, minIntervalMs: 300 });
  });

  test("e-hentai: a page, routed as its viewer page, is paced like the image it opens", () => {
    const decl = ehentaiFactory(host).info.assetRateLimit;
    const page = bridgeImagePath("pos5drow.e-hentai", "https://e-hentai.org/s/abc/1-1");
    expect(assetBudgetFor(decl, page)?.budget).toEqual({ maxConcurrent: 2, minIntervalMs: 3000 });
  });

  test("e-hentai: thumbnails off the CDN, H@H images paced", () => {
    const decl = ehentaiFactory(host).info.assetRateLimit;
    expect(assetBudgetFor(decl, "https://ehgt.org/t/ab/cd/abcd-250.jpg")?.budget).toEqual({});
    expect(assetBudgetFor(decl, "https://x.hath.network:1234/h/abc/keystamp/1.jpg")?.budget).toEqual({ maxConcurrent: 2, minIntervalMs: 3000 });
  });
});
