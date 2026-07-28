/**
 * Unit test for the nhentai "resolve-tags" capability — the reverse lookup that turns bare tag ids
 * (e.g. persisted exclusions) back into names via the `tags/ids` batch endpoint. The mock host records
 * the request and answers with canned TagDtos; no network, no build step.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/nhentai.ts";

/** A host that answers GET /tags/ids?ids=… with canned tags, recording the request URLs it received. */
function tagIdsHost(): { host: HostCapabilities; calls: Array<{ url: string; method?: string }> } {
  const calls: Array<{ url: string; method?: string }> = [];
  const host: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const ok = (body: string): HttpResponse => ({ url: req.url, status: 200, statusText: "OK", headers: {}, body });
        if (new URL(req.url).pathname.endsWith("/tags/ids")) {
          calls.push({ url: req.url, method: req.method });
          // Bare TagDto[] — names for the two ids the test asks about; an unknown id is simply absent.
          return ok(JSON.stringify([
            { id: 19440, type: "tag", name: "big breasts" },
            { id: 32341, type: "tag", name: "sole female" },
          ]));
        }
        return ok("[]");
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
  return { host, calls };
}

describe("nhentai resolve-tags", () => {
  test('advertises the "resolve-tags" capability', () => {
    expect(factory(tagIdsHost().host).info.capabilities).toContain("resolve-tags");
  });

  test("resolves ids to { id, label } via a GET with comma-separated ids", async () => {
    const { host, calls } = tagIdsHost();
    const tags = await factory(host).resolveTags!(["19440", "32341"]);

    expect(tags).toEqual([
      { id: "19440", label: "big breasts" },
      { id: "32341", label: "sole female" },
    ]);
    // A single GET carrying the ids comma-separated in the query.
    expect(calls).toHaveLength(1);
    expect(calls[0].method ?? "GET").toBe("GET");
    expect(new URL(calls[0].url).searchParams.get("ids")).toBe("19440,32341");
  });

  test("skips non-numeric ids and short-circuits when none remain", async () => {
    const { host, calls } = tagIdsHost();
    const tags = await factory(host).resolveTags!(["not-a-number", "  "]);
    expect(tags).toEqual([]);
    expect(calls).toHaveLength(0); // no request when there's nothing numeric to resolve
  });

  test("a failing endpoint yields no labels rather than throwing", async () => {
    const host: HostCapabilities = {
      network: { request: async (req) => ({ url: req.url, status: 500, statusText: "err", headers: {}, body: "nope" }) },
      storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
      log: { debug() {}, info() {}, warn() {}, error() {} },
      settings: {},
    };
    expect(await factory(host).resolveTags!(["19440"])).toEqual([]);
  });
});
