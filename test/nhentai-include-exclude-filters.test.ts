/**
 * Tests for nhentai include/exclude filter support on language, category, and tag filters.
 * All three advertise `excludable: true` and accept `{ include, exclude }` values, which
 * the bridge maps to nhentai's search query syntax: `field:value` for include, `-field:value` for exclude.
 *
 * Tag filters require tag names to be cached (tagNames map) before the search; these tests
 * call `getTags()` first with a mock response to seed the cache, mirroring real usage.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/nhentai.ts";

/** A host that serves CDN config + tag search + a canned search result. Records search request URLs. */
function searchHost(): { host: HostCapabilities; searchUrls: string[] } {
  const searchUrls: string[] = [];
  const host: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const ok = (body: string): HttpResponse => ({ url: req.url, status: 200, statusText: "OK", headers: {}, body });
        const p = new URL(req.url).pathname;
        if (p.endsWith("/cdn")) return ok(JSON.stringify({ image_servers: ["https://i.example"], thumb_servers: ["https://t.example"] }));
        if (p.includes("/tags/search")) return ok(JSON.stringify([
          { id: 1, name: "big breasts", type: "tag" },
          { id: 2, name: "sole female", type: "tag" },
        ]));
        if (p.includes("/search") || p.includes("/galleries")) {
          searchUrls.push(req.url);
          return ok(JSON.stringify({ result: [], num_pages: 0 }));
        }
        return ok("{}");
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
  return { host, searchUrls };
}

/** Extract the decoded `query` search parameter from the captured search URL. */
function queryParam(url: string): string {
  return new URL(url).searchParams.get("query") ?? "";
}

describe("nhentai language filter include/exclude", () => {
  test("include produces language: parts", async () => {
    const { host, searchUrls } = searchHost();
    const bridge = factory(host);
    await bridge.getSearchResults("test", 1, {
      filters: [{ key: "language", value: { include: ["english", "chinese"], exclude: [] } }],
    });
    const q = queryParam(searchUrls[0]!);
    expect(q).toContain("language:english");
    expect(q).toContain("language:chinese");
    expect(q).not.toContain("-language:");
  });

  test("exclude produces -language: parts", async () => {
    const { host, searchUrls } = searchHost();
    const bridge = factory(host);
    await bridge.getSearchResults("test", 1, {
      filters: [{ key: "language", value: { include: [], exclude: ["japanese"] } }],
    });
    const q = queryParam(searchUrls[0]!);
    expect(q).toContain("-language:japanese");
    expect(q).not.toMatch(/(^| )language:japanese/); // no positive form without leading -
  });

  test("mixed include and exclude combine in one query", async () => {
    const { host, searchUrls } = searchHost();
    const bridge = factory(host);
    await bridge.getSearchResults("test", 1, {
      filters: [{ key: "language", value: { include: ["english"], exclude: ["japanese"] } }],
    });
    const q = queryParam(searchUrls[0]!);
    expect(q).toContain("language:english");
    expect(q).toContain("-language:japanese");
  });

  test("legacy string[] value is treated as all-include", async () => {
    const { host, searchUrls } = searchHost();
    const bridge = factory(host);
    await bridge.getSearchResults("test", 1, {
      filters: [{ key: "language", value: ["english"] }],
    });
    const q = queryParam(searchUrls[0]!);
    expect(q).toContain("language:english");
    expect(q).not.toContain("-language:");
  });
});

describe("nhentai category filter include/exclude", () => {
  test("include produces category: parts", async () => {
    const { host, searchUrls } = searchHost();
    const bridge = factory(host);
    await bridge.getSearchResults("test", 1, {
      filters: [{ key: "category", value: { include: ["manga"], exclude: [] } }],
    });
    const q = queryParam(searchUrls[0]!);
    expect(q).toContain("category:manga");
    expect(q).not.toContain("-category:");
  });

  test("exclude produces -category: parts", async () => {
    const { host, searchUrls } = searchHost();
    const bridge = factory(host);
    await bridge.getSearchResults("test", 1, {
      filters: [{ key: "category", value: { include: [], exclude: ["doujinshi"] } }],
    });
    const q = queryParam(searchUrls[0]!);
    expect(q).toContain("-category:doujinshi");
    expect(q).not.toMatch(/(^| )category:doujinshi/); // no positive form without leading -
  });

  test("mixed include and exclude combine", async () => {
    const { host, searchUrls } = searchHost();
    const bridge = factory(host);
    await bridge.getSearchResults("test", 1, {
      filters: [{ key: "category", value: { include: ["manga"], exclude: ["doujinshi"] } }],
    });
    const q = queryParam(searchUrls[0]!);
    expect(q).toContain("category:manga");
    expect(q).toContain("-category:doujinshi");
  });
});

describe("nhentai tag filter include/exclude", () => {
  test("include produces tag:\"name\" parts (after getTags seeds cache)", async () => {
    const { host, searchUrls } = searchHost();
    const bridge = factory(host);
    await bridge.getTags("big"); // seeds tagNames: 1 → "big breasts"
    await bridge.getSearchResults("", 1, {
      filters: [{ key: "tag", value: { include: ["1"], exclude: [] } }],
    });
    // Empty search with tag filter routes through /search, not the fast-path
    const q = queryParam(searchUrls[0]!);
    expect(q).toContain('tag:"big breasts"');
    expect(q).not.toContain('-tag:');
  });

  test("exclude produces -tag:\"name\" parts", async () => {
    const { host, searchUrls } = searchHost();
    const bridge = factory(host);
    await bridge.getTags(""); // seeds tagNames: 1 → "big breasts", 2 → "sole female"
    await bridge.getSearchResults("", 1, {
      filters: [{ key: "tag", value: { include: [], exclude: ["2"] } }],
    });
    const q = queryParam(searchUrls[0]!);
    expect(q).toContain('-tag:"sole female"');
    expect(q).not.toMatch(/(^| )tag:"sole female"/); // no positive form without leading -
  });

  test("tags not in cache are silently omitted", async () => {
    const { host, searchUrls } = searchHost();
    const bridge = factory(host);
    // No getTags call — cache is empty
    await bridge.getSearchResults("test", 1, {
      filters: [{ key: "tag", value: { include: ["999"], exclude: ["888"] } }],
    });
    const q = queryParam(searchUrls[0]!);
    expect(q).not.toContain("tag:");
    expect(q).not.toContain("-tag:");
  });
});

describe("nhentai filter definitions", () => {
  test("language, category, and tag filters are all excludable", async () => {
    const bridge = factory(searchHost().host);
    const filters = await bridge.getFilters!();
    const language = filters.find((f) => f.key === "language");
    const category = filters.find((f) => f.key === "category");
    const tag = filters.find((f) => f.key === "tag");
    expect(language?.type).toBe("multiselect");
    expect((language as any).excludable).toBe(true);
    expect(category?.type).toBe("multiselect");
    expect((category as any).excludable).toBe(true);
    expect(tag?.type).toBe("tag-multiselect");
    expect((tag as any).excludable).toBe(true);
  });
});
