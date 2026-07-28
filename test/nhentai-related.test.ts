/**
 * Unit test for the nhentai related-series rail. The rail is loaded lazily via the dedicated
 * `getRelatedSeries` method (separate from `getSeriesDetails`, off the detail critical path):
 * `GET /galleries/{id}/related` returns the same `{ result: GalleryListItem[] }` shape as the list
 * endpoints, surfaced as a single `RelatedSeriesGroup` labeled "More Like This" with kind "similar".
 *
 * Instantiates the bridge directly with a mock host that answers the related + cdn endpoints with
 * canned JSON — no network, no build step. `@comical/*` resolve to the sibling monorepo source.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/nhentai.ts";

interface RelatedGallery {
  id: number;
  media_id: string;
  english_title?: string;
  thumbnail?: string;
  tag_ids?: number[];
}

const R1: RelatedGallery = { id: 11, media_id: "m11", english_title: "Related One", thumbnail: "galleries/11/thumb.webp", tag_ids: [3] };
const R2: RelatedGallery = { id: 12, media_id: "m12", english_title: "Related Two", thumbnail: "galleries/12/thumb.webp", tag_ids: [4] };

/**
 * A host that serves the gallery detail and its /related list. `related` controls the related
 * payload so a test can exercise both the populated and empty cases.
 */
function detailHost(related: RelatedGallery[]): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const path = new URL(req.url).pathname;
        let body: string;
        if (path.endsWith("/cdn")) {
          body = JSON.stringify({ image_servers: ["https://i.example"], thumb_servers: ["https://t.example"] });
        } else if (path.endsWith("/related")) {
          body = JSON.stringify({ result: related });
        } else {
          // Gallery detail (GalleryDetail shape).
          body = JSON.stringify({
            id: 1,
            media_id: "m1",
            title: { english: "Subject Gallery", pretty: "Subject" },
            cover: { path: "galleries/1/cover.webp" },
            tags: [{ id: 9, type: "tag", name: "example" }],
          });
        }
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

describe("nhentai related-series rail", () => {
  test('maps /related galleries into one "More Like This" (kind: similar) group', async () => {
    const bridge = factory(detailHost([R1, R2]));
    const groups = await bridge.getRelatedSeries("1");

    expect(groups).toHaveLength(1);
    expect(groups[0]!.label).toBe("More Like This");
    expect(groups[0]!.kind).toBe("similar");
    expect(groups[0]!.series.map((s) => s.id)).toEqual(["11", "12"]);
    expect(groups[0]!.series[0]!.title).toBe("Related One");
    // Covers resolve through the bridge's CDN/thumb pipeline.
    expect(groups[0]!.series[0]!.thumbnailUrl).toContain("galleries/11/thumb.webp");
  });

  test("returns no groups when the gallery has no related items", async () => {
    const bridge = factory(detailHost([]));
    expect(await bridge.getRelatedSeries("1")).toEqual([]);
  });
});
