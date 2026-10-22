/**
 * What opening a gallery costs. An open asks for the page list and the favorite status at once, and
 * the gallery's front page answers both — so it's fetched once, and `/mpv/` only for an account that
 * has the multi-page viewer on (the page links it). Also: the site's "opening pages too fast"
 * warning, which arrives as a 200, holds the bridge instead of being pressed through.
 *
 * Drives the public bridge methods against a mock host that records every URL it fetches.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import { parseRateLimited } from "@comical/sdk";
import factory, { favoritedFromGalleryPage, offersMpv, parsePageUrl, sourceRefusal, tooFastWarning } from "../src/ehentai.ts";

const GID = 4264863;
const TOKEN = "16c12f5659";
const SERIES = `${GID}:${TOKEN}`;
const TOO_FAST =
  "You are opening pages too fast, thus placing a heavy load on the server. Back down, or your IP address will be automatically banned.";

/** A gallery front page: 3 images, the favorite link reading `fav`, thumbnails linking `/s/` or `/mpv/`. */
function galleryPage({ fav = "Add to Favorites", mpv = false } = {}): string {
  const thumbs = [1, 2, 3]
    .map((n) => {
      const href = mpv ? `https://e-hentai.org/mpv/${GID}/${TOKEN}/#page${n}` : `https://e-hentai.org/s/abc${n}/${GID}-${n}`;
      return `<a href="${href}"><div title="Page ${n}: ${n}.png" style="width:200px;height:115px;background:transparent url(https://x.hath.network/c/${GID}-0.webp) -${(n - 1) * 200}px 0 no-repeat"></div></a>`;
    })
    .join("");
  return `<html><body>${"<p>filler</p>".repeat(200)}
    <div id="gdf"><a id="favoritelink" href="#" onclick="return false"><img src="https://ehgt.org/g/mr.gif" /> ${fav}</a></div>
    <p class="gpc">Showing 1 - 3 of 3 images</p>
    <div id="gdt">${thumbs}</div></body></html>`;
}

const MPV_PAGE = `<html><script>var imagelist = [{"n":"1.png","k":"k1","t":""},{"n":"2.png","k":"k2","t":""},{"n":"3.png","k":"k3","t":""}];</script></html>`;

function recordingHost(respond: (url: string) => string, settings: Record<string, string> = {}) {
  const urls: string[] = [];
  const host: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        urls.push(req.url);
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body: respond(req.url) };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings,
  };
  return { bridge: factory(host), urls };
}

const SIGNED_IN = { cookies: "ipb_member_id=1; ipb_pass_hash=abc" };
const galleryUrls = (urls: string[]) => urls.filter((u) => u.includes(`/g/${GID}/`));
const mpvUrls = (urls: string[]) => urls.filter((u) => u.includes("/mpv/"));

describe("favoritedFromGalleryPage", () => {
  test("'Add to Favorites' means not favorited", () => {
    expect(favoritedFromGalleryPage(galleryPage())).toBe(false);
  });

  test("a category name means favorited", () => {
    expect(favoritedFromGalleryPage(galleryPage({ fav: "Favorites 3" }))).toBe(true);
    expect(favoritedFromGalleryPage(galleryPage({ fav: "My &amp; Stuff" }))).toBe(true);
  });

  test("a page without the link says nothing", () => {
    expect(favoritedFromGalleryPage("<html><body>nothing here</body></html>")).toBeUndefined();
  });
});

describe("offersMpv", () => {
  test("thumbnails linking /mpv/ mean the account has it on", () => {
    expect(offersMpv(galleryPage({ mpv: true }))).toBe(true);
  });

  test("thumbnails linking /s/ mean it doesn't", () => {
    expect(offersMpv(galleryPage())).toBe(false);
  });

  test("a lone mention isn't the setting", () => {
    expect(offersMpv(`<a href="https://e-hentai.org/mpv/${GID}/${TOKEN}/">MPV</a>`)).toBe(false);
  });
});

describe("tooFastWarning", () => {
  test("the warning is a rate-limited refusal with a wait", () => {
    const err = tooFastWarning(TOO_FAST);
    expect(err).toBeDefined();
    expect(parseRateLimited(err!.message)?.retryAfterMs).toBeGreaterThan(0);
    expect(parseRateLimited(sourceRefusal(TOO_FAST)!.message)?.retryAfterMs).toBeGreaterThan(0);
  });

  test("a full page that quotes it is not one", () => {
    expect(tooFastWarning(galleryPage() + TOO_FAST)).toBeUndefined();
  });

  test("an ordinary page is not one", () => {
    expect(tooFastWarning(galleryPage())).toBeUndefined();
  });
});

describe("opening a gallery", () => {
  test("pages + favorite status share one gallery-page fetch, and no MPV when it isn't offered", async () => {
    const { bridge, urls } = recordingHost((u) => (u.includes("/mpv/") ? MPV_PAGE : galleryPage({ fav: "Favorites 0" })), SIGNED_IN);
    const [pages, fav] = await Promise.all([bridge.getSeriesPages!(SERIES), bridge.isFavorite!(SERIES)]);
    expect(pages).toHaveLength(3);
    expect(fav).toBe(true);
    expect(galleryUrls(urls)).toHaveLength(1);
    expect(mpvUrls(urls)).toHaveLength(0);
  });

  test("the first viewer page's hashes come from that same fetch", async () => {
    const { bridge, urls } = recordingHost((u) =>
      u.includes("/s/") ? `<img id="img" src="https://x.hath.network/h/1.jpg" />` : galleryPage(),
    );
    const pages = await bridge.getSeriesPages!(SERIES);
    expect(pages[1]!.imageUrl).toBe(`https://e-hentai.org/mpv/${GID}/${TOKEN}/#page2`);
    expect(await bridge.interceptImageRequest!(pages[1]!.imageUrl)).toEqual({ url: "https://x.hath.network/h/1.jpg" });
    expect(galleryUrls(urls)).toHaveLength(1);
    expect(urls.at(-1)).toContain(`/s/abc2/${GID}-2`);
  });

  test("pages saved before `images` still resolve through resolvePage", async () => {
    const { bridge, urls } = recordingHost((u) =>
      u.includes("/s/") ? `<img id="img" src="https://x.hath.network/h/1.jpg" />` : galleryPage(),
    );
    expect(await bridge.resolvePage!(SERIES, "_", `${GID}-2`)).toBe("https://x.hath.network/h/1.jpg");
    expect(urls.at(-1)).toContain(`/s/abc2/${GID}-2`);
  });

  test("MPV is fetched when the gallery page links it, and each page is its viewer page", async () => {
    const { bridge, urls } = recordingHost((u) => (u.includes("/mpv/") ? MPV_PAGE : galleryPage({ mpv: true })), SIGNED_IN);
    const pages = await bridge.getSeriesPages!(SERIES);
    expect(pages.map((p) => p.imageUrl)).toEqual([1, 2, 3].map((n) => `https://e-hentai.org/s/k${n}/${GID}-${n}`));
    expect(mpvUrls(urls)).toHaveLength(1);
  });

  test("a failed gallery-page fetch isn't kept", async () => {
    let fail = true;
    const { bridge, urls } = recordingHost(() => {
      if (fail) {
        fail = false;
        throw new Error("network down");
      }
      return galleryPage();
    });
    await expect(bridge.getSeriesPages!(SERIES)).rejects.toThrow("network down");
    expect(await bridge.getSeriesPages!(SERIES)).toHaveLength(3);
    expect(galleryUrls(urls)).toHaveLength(2);
  });
});

describe("page URLs", () => {
  test("parse back into the page they name", () => {
    expect(parsePageUrl(`https://e-hentai.org/s/abc1/${GID}-7`)).toEqual({ hash: "abc1", gid: GID, pageNum: 7 });
    expect(parsePageUrl(`https://e-hentai.org/mpv/${GID}/${TOKEN}/#page21`)).toEqual({ gid: GID, token: TOKEN, pageNum: 21 });
  });

  test("anything else isn't one, and the interceptor refuses it", async () => {
    expect(parsePageUrl(`https://exhentai.org/s/abc1/${GID}-7`)).toBeUndefined();
    expect(parsePageUrl(`https://e-hentai.org/g/${GID}/${TOKEN}/`)).toBeUndefined();
    expect(parsePageUrl(`https://e-hentai.org/s/abc1/${GID}-7?nl=1`)).toBeUndefined();
    const { bridge, urls } = recordingHost(() => galleryPage());
    await expect(bridge.interceptImageRequest!("https://ehgt.org/t/a.jpg")).rejects.toThrow("Not a page URL");
    expect(urls).toHaveLength(0);
  });
});

describe("the too-fast hold", () => {
  test("after the warning, every request fails fast as rate-limited without reaching the site", async () => {
    const { bridge, urls } = recordingHost(() => TOO_FAST);
    const first = await bridge.getSeriesPages!(SERIES).catch((e: Error) => e);
    expect(parseRateLimited((first as Error).message)).toBeDefined();
    const second = await bridge.interceptImageRequest!(`https://e-hentai.org/s/abc1/${GID}-1`).catch((e: Error) => e);
    expect(parseRateLimited((second as Error).message)?.retryAfterMs).toBeGreaterThan(0);
    expect(urls).toHaveLength(1);
  });
});
