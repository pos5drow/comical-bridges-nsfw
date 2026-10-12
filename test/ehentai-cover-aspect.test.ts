/**
 * e-hentai's cover shape (`thumbnailAspect`). A listing page draws every cover with an inline
 * `style="height:Hpx;width:Wpx"` sized to the picture, and that image's URL is the very `thumb`
 * gdata returns — so the bridge reads the shape out of HTML it already fetched. Lazy-loaded rows
 * carry the real URL in `data-src` behind a placeholder `src`; exhentai thumbs are matched after
 * the same host normalization the cover URL gets. A cover the page didn't size carries no shape.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/ehentai.ts";

const PLACEHOLDER = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

const LISTING = `<html><body>
  <a href="https://e-hentai.org/g/1/aa/"><img style="height:141px;width:250px" alt="One" src="https://ehgt.org/w/01/001/1-a.webp" /></a>
  <a href="https://e-hentai.org/g/2/bb/"><img style="height:350px;width:250px" alt="Two" src="${PLACEHOLDER}" data-src="https://ehgt.org/w/01/002/2-b.webp" /></a>
  <a href="https://e-hentai.org/g/3/cc/"><img style="height:300px;width:250px" alt="Three" src="https://s.exhentai.org/t/w/01/003/3-c.webp" /></a>
  <a href="https://e-hentai.org/g/4/dd/"><img alt="Four" src="https://ehgt.org/w/01/004/4-d.webp" /></a>
  <a href="https://e-hentai.org/g/5/ee/"><img style="height:0px;width:250px" alt="Five" src="https://ehgt.org/w/01/005/5-e.webp" /></a>
  <img src="https://ehgt.org/g/t.png" alt="T" title="Show torrents" />
</body></html>`;

const GDATA = {
  gmetadata: [
    { gid: 1, token: "aa", title: "One", thumb: "https://ehgt.org/w/01/001/1-a.webp" },
    { gid: 2, token: "bb", title: "Two", thumb: "https://ehgt.org/w/01/002/2-b.webp" },
    { gid: 3, token: "cc", title: "Three", thumb: "https://s.exhentai.org/t/w/01/003/3-c.webp" },
    { gid: 4, token: "dd", title: "Four", thumb: "https://ehgt.org/w/01/004/4-d.webp" },
    { gid: 5, token: "ee", title: "Five", thumb: "https://ehgt.org/w/01/005/5-e.webp" },
  ],
};

function host(): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const ok = (body: string): HttpResponse => ({ url: req.url, status: 200, statusText: "OK", headers: {}, body });
        return ok(req.url.includes("api.e-hentai.org") ? JSON.stringify(GDATA) : LISTING);
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

describe("e-hentai cover aspect", () => {
  test("listing entries carry each cover's inline width / height", async () => {
    const bridge = factory(host());
    const { items } = await bridge.getSearchResults!({ text: "anything" });
    const byId = new Map(items.map((e) => [e.id, e]));
    expect(byId.get("1:aa")!.thumbnailAspect).toBeCloseTo(250 / 141);
    // Lazy-loaded: the shape belongs to `data-src`, not the placeholder.
    expect(byId.get("2:bb")!.thumbnailAspect).toBeCloseTo(250 / 350);
    // exhentai host: matched after normalization, against the URL the entry actually carries.
    expect(byId.get("3:cc")!.thumbnailUrl).toBe("https://ehgt.org/w/01/003/3-c.webp");
    expect(byId.get("3:cc")!.thumbnailAspect).toBeCloseTo(250 / 300);
  });

  test("a cover the page didn't size, or sized to nothing, carries no aspect", async () => {
    const bridge = factory(host());
    const { items } = await bridge.getSearchResults!({ text: "anything" });
    const byId = new Map(items.map((e) => [e.id, e]));
    expect(byId.get("4:dd")!.thumbnailUrl).toBeDefined();
    expect(byId.get("4:dd")!.thumbnailAspect).toBeUndefined();
    expect(byId.get("5:ee")!.thumbnailAspect).toBeUndefined();
  });
});
