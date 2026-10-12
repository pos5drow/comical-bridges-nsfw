/**
 * nhentai's cover shape (`thumbnailAspect`). The list payload already carries each thumbnail's
 * `thumbnail_width`/`thumbnail_height` and the detail payload its cover's `width`/`height`, so the
 * bridge hands the host the cover's shape at no extra cost — and simply omits it when the API
 * didn't send both dimensions.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/nhentai.ts";

const LIST = [
  { id: 1, media_id: "m1", english_title: "Wide", thumbnail: "galleries/1/thumb.webp", thumbnail_width: 250, thumbnail_height: 200 },
  { id: 2, media_id: "m2", english_title: "No dims", thumbnail: "galleries/2/thumb.webp" },
  { id: 3, media_id: "m3", english_title: "Zero height", thumbnail: "galleries/3/thumb.webp", thumbnail_width: 250, thumbnail_height: 0 },
  { id: 4, media_id: "m4", english_title: "Excluded", thumbnail: "galleries/4/thumb.webp", thumbnail_width: 250, thumbnail_height: 350, tag_ids: [100] },
];

function host(detailCover: Record<string, unknown>): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const path = new URL(req.url).pathname;
        let body: string;
        if (path.endsWith("/cdn")) {
          body = JSON.stringify({ image_servers: ["https://i.example"], thumb_servers: ["https://t.example"] });
        } else if (path.endsWith("/galleries/popular")) {
          body = JSON.stringify(LIST);
        } else if (path.endsWith("/related")) {
          body = JSON.stringify({ result: [] });
        } else if (/\/galleries\/\d+$/.test(path)) {
          body = JSON.stringify({ id: 1, media_id: "m1", title: { english: "Wide" }, ...detailCover, num_pages: 1 });
        } else {
          body = JSON.stringify({ result: LIST, num_pages: 1 });
        }
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

describe("nhentai cover aspect", () => {
  test("list entries carry the thumbnail's width / height, only when both are present and non-zero", async () => {
    const bridge = factory(host({}));
    const { items } = await bridge.getListItems("popular-now", { excludedTags: ["100"] });
    expect(items[0]!.thumbnailAspect).toBe(1.25);
    expect(items[1]!.thumbnailAspect).toBeUndefined();
    expect(items[2]!.thumbnailAspect).toBeUndefined();
    // A redacted placeholder has no cover, so no shape either.
    expect(items[3]!.excluded).toBe(true);
    expect(items[3]!.thumbnailAspect).toBeUndefined();
  });

  test("search results carry it too", async () => {
    const bridge = factory(host({}));
    const { items } = await bridge.getSearchResults({ text: "anything" });
    expect(items[0]!.thumbnailAspect).toBe(1.25);
  });

  test("details take the cover's own dimensions", async () => {
    const bridge = factory(host({ cover: { path: "galleries/1/cover.webp", width: 350, height: 500 } }));
    const info = await bridge.getSeriesDetails("1");
    expect(info.thumbnailUrl).toEndWith("/galleries/1/cover.webp");
    expect(info.thumbnailAspect).toBe(0.7);
  });

  test("details fall back to the thumbnail's dimensions along with its path", async () => {
    const bridge = factory(host({ thumbnail: { path: "galleries/1/thumb.webp", width: 250, height: 200 } }));
    const info = await bridge.getSeriesDetails("1");
    expect(info.thumbnailUrl).toEndWith("/galleries/1/thumb.webp");
    expect(info.thumbnailAspect).toBe(1.25);
  });

  test("details without dimensions carry no aspect", async () => {
    const bridge = factory(host({ cover: { path: "galleries/1/cover.webp" } }));
    const info = await bridge.getSeriesDetails("1");
    expect(info.thumbnailAspect).toBeUndefined();
  });
});
