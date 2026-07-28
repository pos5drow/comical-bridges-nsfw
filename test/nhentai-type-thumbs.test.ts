/**
 * Unit tests for two nhentai detail behaviours:
 *  - the gallery "category" (Doujinshi / Manga / …) is surfaced as SeriesInfo.type, not a lone genre;
 *  - page thumbnails use the API-provided `thumbnail` path (the crisp ~400px `…t.webp` preview off the
 *    thumb CDN), honouring nhentai's inconsistent double extension (`2t.webp.webp`) rather than
 *    deriving it from the page path (which would 404 those pages and look low-res).
 *
 * Instantiates the bridge with a mock host answering the detail + CDN endpoints with canned JSON —
 * no network, no build step.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/nhentai.ts";

/** A host serving one gallery's detail (with category + content tags + pages) and the CDN config. */
function detailHost(): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const path = new URL(req.url).pathname;
        let body: string;
        if (path.endsWith("/cdn")) {
          body = JSON.stringify({ image_servers: ["https://i.example"], thumb_servers: ["https://t.example"] });
        } else if (path.endsWith("/related")) {
          body = JSON.stringify({ result: [] });
        } else {
          body = JSON.stringify({
            id: 1,
            media_id: "m1",
            title: { english: "Subject Gallery", pretty: "Subject" },
            cover: { path: "galleries/1/cover.webp" },
            tags: [
              { id: 9, type: "tag", name: "schoolgirl" },
              { id: 5, type: "category", name: "doujinshi" },
            ],
            pages: [
              { number: 1, path: "galleries/m1/1.webp", thumbnail: "galleries/m1/1t.webp" },
              // nhentai's real double-extension thumbnail — must be carried verbatim, not derived.
              { number: 2, path: "galleries/m1/2.webp", thumbnail: "galleries/m1/2t.webp.webp" },
              { number: 3, path: "galleries/m1/3.webp" }, // no thumbnail field → derive as fallback
            ],
            num_pages: 3,
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

describe("nhentai category → SeriesInfo.type", () => {
  test("category becomes the type, and is not folded into a genre group", async () => {
    const bridge = factory(detailHost());
    const info = await bridge.getSeriesDetails("1");
    expect(info.type).toBe("doujinshi");
    // The category must NOT also show up as a genre chip — nhentai emits no `kind: "genre"` group.
    expect(info.tagGroups?.some((g) => g.kind === "genre")).toBeFalsy();
  });
});

describe("nhentai page thumbnails", () => {
  test("use the API thumbnail path off the thumb CDN (not the full image), honouring double extensions", async () => {
    const bridge = factory(detailHost());
    const pages = await bridge.getSeriesPages!("1");
    expect(pages).toHaveLength(3);
    const thumbUrl = (i: number) => (pages[i]!.thumbnail as { kind: string; url: string });
    // Page 1: the lightweight `t` thumbnail — not the full image (which is what imageUrl points at).
    expect(thumbUrl(0).kind).toBe("image");
    expect(thumbUrl(0).url).toEndWith("/galleries/m1/1t.webp");
    expect(thumbUrl(0).url).not.toBe(pages[0]!.imageUrl);
    expect(pages[0]!.imageUrl).toEndWith("/galleries/m1/1.webp"); // full image stays on imageUrl
    // Page 2: the double-extension thumbnail is carried verbatim (deriving it would 404).
    expect(thumbUrl(1).url).toEndWith("/galleries/m1/2t.webp.webp");
    // Page 3: no API thumbnail → derive the `t` suffix as a fallback.
    expect(thumbUrl(2).url).toEndWith("/galleries/m1/3t.webp");
  });
});
