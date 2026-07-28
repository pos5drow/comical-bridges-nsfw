/**
 * Unit tests for the nhentai favorites mutations. The favorite/unfavorite POST/DELETE endpoints
 * respond with a body that isn't reliably JSON (often empty), so the mutations must succeed off the
 * HTTP status alone. The regression these guard against: addFavorite used to parse the response body
 * as JSON, which threw on an otherwise-successful POST — the caller's optimistic star then reverted
 * even though the favorite was recorded server-side.
 *
 * Instantiates the bridge directly with a mock host (no network, no build). `@comical/*` resolve to
 * the sibling monorepo source.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/nhentai.ts";

/** A host with the apiKey set (favorites require it) that records requests and returns canned replies. */
function favHost(reply: (req: HttpRequest) => HttpResponse): { host: HostCapabilities; seen: HttpRequest[] } {
  const seen: HttpRequest[] = [];
  const host: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        seen.push(req);
        return reply(req);
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: { apiKey: "test-key" },
  };
  return { host, seen };
}

const ok = (url: string, body = ""): HttpResponse => ({ url, status: 200, statusText: "OK", headers: {}, body });

describe("nhentai addFavorite", () => {
  test("succeeds on a 200 with an empty (non-JSON) body — no parse throw", async () => {
    const { host, seen } = favHost((req) => ok(req.url));
    const bridge = factory(host);
    // Must not throw even though the body is "" (JSON.parse("") would throw).
    await bridge.addFavorite!("177013");
    const post = seen.find((r) => r.method === "POST");
    expect(post).toBeDefined();
    expect(post!.url).toContain("/galleries/177013/favorite");
  });

  test("throws on a >= 400 status", async () => {
    const { host } = favHost((req) => ({ url: req.url, status: 403, statusText: "Forbidden", headers: {}, body: "" }));
    const bridge = factory(host);
    await expect(bridge.addFavorite!("177013")).rejects.toThrow();
  });

  test("requires an apiKey", async () => {
    const host = favHost(() => ok("")).host;
    host.settings = {};
    const bridge = factory(host);
    await expect(bridge.addFavorite!("177013")).rejects.toThrow(/api key/i);
  });
});

describe("nhentai removeFavorite", () => {
  test("succeeds on a 200 with an empty body and issues a DELETE", async () => {
    const { host, seen } = favHost((req) => ok(req.url));
    const bridge = factory(host);
    await bridge.removeFavorite!("177013");
    const del = seen.find((r) => r.method === "DELETE");
    expect(del).toBeDefined();
    expect(del!.url).toContain("/galleries/177013/favorite");
  });
});

describe("nhentai isFavorite", () => {
  test("uses the single-gallery status endpoint and returns its `favorited`", async () => {
    const { host, seen } = favHost((req) => ok(req.url, JSON.stringify({ favorited: true, num_favorites: 5 })));
    const bridge = factory(host);
    expect(await bridge.isFavorite!("42")).toBe(true);
    // O(1) — one GET to /galleries/{id}/favorite, not a scan of /favorites pages.
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toContain("/galleries/42/favorite");
    expect(seen[0]!.method ?? "GET").toBe("GET");
  });

  test("false when the endpoint reports not favorited", async () => {
    const { host } = favHost((req) => ok(req.url, JSON.stringify({ favorited: false })));
    const bridge = factory(host);
    expect(await bridge.isFavorite!("42")).toBe(false);
  });
});
