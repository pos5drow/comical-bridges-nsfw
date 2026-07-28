/**
 * Unit test for the nhentai "exclude-tags" capability. Unlike Atsumaru (which pushes exclusions into
 * the Typesense query), nhentai's list/search payloads carry an inline `tag_ids` array on every item,
 * so the bridge filters in-memory at zero added network cost: any item whose `tag_ids` intersect the
 * user's `excludedTags` becomes a redacted placeholder (`excluded: true`, no real title, no thumbnail)
 * rather than being dropped, on all three surfaces — Popular Now (non-paginated), New Arrivals
 * (paginated), and search.
 *
 * Instantiates the bridge directly with a mock host that answers each endpoint with canned galleries —
 * no network, no build step. `@comical/*` resolve to the sibling monorepo source via tsconfig paths.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse, SeriesEntry } from "@comical/contract";
import factory from "../src/nhentai.ts";

interface Gallery {
  id: number;
  media_id: string;
  english_title?: string;
  thumbnail?: string;
  tag_ids?: number[];
}

/** Two galleries: #1 carries the soon-to-be-excluded tag 100; #2 is clean. */
const G_EXCLUDED: Gallery = { id: 1, media_id: "m1", english_title: "Tagged One", thumbnail: "galleries/1/thumb.webp", tag_ids: [100, 5] };
const G_CLEAN: Gallery = { id: 2, media_id: "m2", english_title: "Clean Two", thumbnail: "galleries/2/thumb.webp", tag_ids: [7, 8] };

/** A host that serves canned JSON per endpoint. The same two galleries back every list/search route. */
function cannedHost(): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const path = new URL(req.url).pathname;
        let body: string;
        if (path.endsWith("/cdn")) {
          body = JSON.stringify({ image_servers: ["https://i.example"], thumb_servers: ["https://t.example"] });
        } else if (path.endsWith("/galleries/popular")) {
          // Popular Now returns a bare array.
          body = JSON.stringify([G_EXCLUDED, G_CLEAN]);
        } else {
          // New Arrivals (/galleries) and /search return the paginated shape.
          body = JSON.stringify({ result: [G_EXCLUDED, G_CLEAN], num_pages: 1 });
        }
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

/** Assert an entry is a redacted placeholder: flagged, no real title, no cover to fetch. */
function expectRedacted(entry: SeriesEntry, id: string) {
  expect(entry.id).toBe(id);
  expect(entry.excluded).toBe(true);
  expect(entry.title).toBe("Hidden");
  expect(entry.thumbnailUrl).toBeUndefined();
}

/** Assert an entry rendered normally: real title, cover present, not flagged. */
function expectVisible(entry: SeriesEntry, id: string, title: string) {
  expect(entry.id).toBe(id);
  expect(entry.excluded).toBeUndefined();
  expect(entry.title).toBe(title);
  expect(entry.thumbnailUrl).toContain("galleries/");
}

describe("nhentai exclude-tags in-bridge filtering", () => {
  test('advertises the "exclude-tags" capability', () => {
    const bridge = factory(cannedHost());
    expect(bridge.info.capabilities).toContain("exclude-tags");
  });

  test("Popular Now (non-paginated) redacts items whose tag_ids match", async () => {
    const bridge = factory(cannedHost());
    const { items } = await bridge.getListItems("popular-now", 1, { excludedTags: ["100"] });
    expect(items).toHaveLength(2);
    expectRedacted(items[0]!, "1");
    expectVisible(items[1]!, "2", "Clean Two");
  });

  test("New Arrivals (paginated) redacts items whose tag_ids match", async () => {
    const bridge = factory(cannedHost());
    const { items } = await bridge.getListItems("new", 1, { excludedTags: ["100"] });
    expect(items).toHaveLength(2);
    expectRedacted(items[0]!, "1");
    expectVisible(items[1]!, "2", "Clean Two");
  });

  test("search redacts items whose tag_ids match (same as home sections)", async () => {
    const bridge = factory(cannedHost());
    // A non-empty query forces the /search endpoint (not the empty-date fast-path).
    const { items } = await bridge.getSearchResults("anything", 1, { excludedTags: ["100"] });
    expect(items).toHaveLength(2);
    expectRedacted(items[0]!, "1");
    expectVisible(items[1]!, "2", "Clean Two");
  });

  test("empty date-sorted search fast-path also filters", async () => {
    const bridge = factory(cannedHost());
    const { items } = await bridge.getSearchResults("", 1, { excludedTags: ["100"] });
    expect(items).toHaveLength(2);
    expectRedacted(items[0]!, "1");
    expectVisible(items[1]!, "2", "Clean Two");
  });

  test("no excluded tags → every item renders normally", async () => {
    const bridge = factory(cannedHost());
    const { items } = await bridge.getListItems("popular-now", 1, {});
    expectVisible(items[0]!, "1", "Tagged One");
    expectVisible(items[1]!, "2", "Clean Two");
  });

  test("blank / whitespace-only excluded ids are ignored", async () => {
    const bridge = factory(cannedHost());
    const { items } = await bridge.getListItems("popular-now", 1, { excludedTags: ["  ", ""] });
    expectVisible(items[0]!, "1", "Tagged One");
    expectVisible(items[1]!, "2", "Clean Two");
  });

  test("a non-matching exclusion leaves all items visible", async () => {
    const bridge = factory(cannedHost());
    const { items } = await bridge.getListItems("popular-now", 1, { excludedTags: ["999"] });
    expectVisible(items[0]!, "1", "Tagged One");
    expectVisible(items[1]!, "2", "Clean Two");
  });
});
