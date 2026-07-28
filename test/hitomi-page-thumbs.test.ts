/**
 * Regression: hitomi per-page thumbnails.
 *
 * Hitomi only renders the big `webpbigtn` thumbnail for a gallery's cover image(s); interior pages
 * 404 on that path and are only available as the smaller `webpsmalltn`. The reader's page-thumbnail
 * strip must therefore use `webpsmalltn` — otherwise every page past the first showed a broken
 * thumbnail. The full page image (imageUrl) is unaffected and stays on the gg-derived path.
 *
 * Instantiates the bridge with a mock host answering `galleries/{id}.js` + `gg.js` — no network.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/hitomi.ts";

const H0 = "0000000000000000000000000000000000000000000000000000000000000abc";
const H1 = "1111111111111111111111111111111111111111111111111111111111111def";

function galleryHost(): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const ok = (body: string): HttpResponse => ({ url: req.url, status: 200, statusText: "OK", headers: {}, body });
        if (req.url.endsWith("/gg.js")) {
          return ok("gg = { m: function(g){ var o=0; switch(g){ case 1: o=1; break; } return o; }, b: '1700000000/' };");
        }
        // galleries/{id}.js — the `var galleryinfo = {…}` document.
        return ok(
          "var galleryinfo = " +
            JSON.stringify({
              id: "1",
              title: "Subject",
              files: [
                { name: "1.webp", hash: H0, hasavif: 1 },
                { name: "2.webp", hash: H1 },
              ],
            }),
        );
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

/** Pull the real CDN URL back out of the `/img-proxy?url=…` wrapper the bridge emits. */
function unproxy(u: string): string {
  const m = u.match(/\/img-proxy\?url=(.+)$/);
  return m ? decodeURIComponent(m[1]!) : u;
}

describe("hitomi page thumbnails", () => {
  test("use webpsmalltn (available for every page), not webpbigtn (cover-only)", async () => {
    const pages = await factory(galleryHost()).getSeriesPages!("1");
    expect(pages).toHaveLength(2);

    for (const pg of pages) {
      const thumb = pg.thumbnail as { kind: string; url: string };
      const url = unproxy(thumb.url);
      expect(thumb.kind).toBe("image");
      expect(url).toContain("/webpsmalltn/");
      expect(url).not.toContain("/webpbigtn/");
    }

    // The full image is still the gg-derived page URL — the thumbnail must not equal it.
    expect(pages[0]!.imageUrl).not.toBe(pages[0]!.thumbnail && (pages[0]!.thumbnail as { url: string }).url);
    expect(unproxy(pages[0]!.imageUrl)).toContain(".avif"); // hasavif → avif page image
  });
});
