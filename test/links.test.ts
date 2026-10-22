/**
 * Opening a pasted web link (`linkHosts` + `resolveUrl`, contract 2.1). Gallery links parse with no
 * fetch; an e-hentai page link has no gallery token, which one `gtoken` API call looks up.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import ehentai, { parseGalleryLink as ehGallery } from "../src/ehentai.ts";
import hitomi, { parseGalleryLink as hitomiGallery } from "../src/hitomi.ts";
import nhentai from "../src/nhentai.ts";

/** A host that answers every request with `respond()` and records what was sent. */
function host(respond: () => string = () => "{}") {
  const sent: HttpRequest[] = [];
  const caps: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        sent.push(req);
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body: respond() };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
  return { caps, sent };
}

describe("e-hentai resolveUrl", () => {
  const GID = 4264863;
  const TOKEN = "16c12f5659";

  test("declares both sites", () => {
    expect(ehentai(host().caps).info.linkHosts).toEqual(["e-hentai.org", "exhentai.org"]);
  });

  test("opens gallery and viewer links without fetching", async () => {
    const { caps, sent } = host();
    const bridge = ehentai(caps);
    for (const url of [
      `https://e-hentai.org/g/${GID}/${TOKEN}/`,
      `https://exhentai.org/g/${GID}/${TOKEN}/?p=2`,
      `https://e-hentai.org/mpv/${GID}/${TOKEN}/#page4`,
      `https://e-hentai.org/g/${GID}/${TOKEN.toUpperCase()}`,
    ]) {
      expect(await bridge.resolveUrl!(url)).toEqual({ seriesId: `${GID}:${TOKEN}` });
    }
    expect(sent).toEqual([]);
  });

  test("looks a page link's gallery token up with gtoken", async () => {
    const { caps, sent } = host(() => JSON.stringify({ tokenlist: [{ gid: GID, token: TOKEN }] }));
    const bridge = ehentai(caps);
    expect(await bridge.resolveUrl!(`https://e-hentai.org/s/0123456789ab/${GID}-7`)).toEqual({ seriesId: `${GID}:${TOKEN}` });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("POST");
    expect(JSON.parse(sent[0]!.body as string)).toEqual({ method: "gtoken", pagelist: [[GID, "0123456789", 7]] });
  });

  test("a page the API can't place, or any other page, opens nothing", async () => {
    const bridge = ehentai(host(() => JSON.stringify({ tokenlist: [{ error: "not found" }] })).caps);
    expect(await bridge.resolveUrl!(`https://e-hentai.org/s/0123456789/${GID}-1`)).toBeNull();
    expect(await bridge.resolveUrl!("https://e-hentai.org/?f_search=x")).toBeNull();
    expect(await bridge.resolveUrl!("https://e-hentai.org/tag/female:glasses")).toBeNull();
  });

  test("parseGalleryLink refuses a truncated token", () => {
    expect(ehGallery(`https://e-hentai.org/g/${GID}/16c12f/`)).toBeUndefined();
  });
});

describe("hitomi resolveUrl", () => {
  test("declares its site", () => {
    expect(hitomi(host().caps).info.linkHosts).toEqual(["hitomi.la"]);
  });

  test("opens every gallery link shape without fetching", async () => {
    const { caps, sent } = host();
    const bridge = hitomi(caps);
    for (const url of [
      "https://hitomi.la/reader/2345678.html#3",
      "https://hitomi.la/galleries/2345678.html",
      "https://hitomi.la/doujinshi/some-title-2024-english-2345678.html",
      "https://hitomi.la/manga/title-2345678.html?x",
      "https://hitomi.la/gamecg/2345678.html",
    ]) {
      expect(await bridge.resolveUrl!(url)).toEqual({ seriesId: "2345678" });
    }
    expect(sent).toEqual([]);
  });

  test("ignores tag, search and index pages", async () => {
    const bridge = hitomi(host().caps);
    for (const url of [
      "https://hitomi.la/",
      "https://hitomi.la/index-english.html",
      "https://hitomi.la/tag/female%3Aglasses-all.html",
      "https://hitomi.la/artist/someone-all.html",
      "https://hitomi.la/search.html?glasses",
    ]) {
      expect(await bridge.resolveUrl!(url)).toBeNull();
    }
    expect(hitomiGallery("https://example.test/reader/1.html")).toBeUndefined();
  });
});

describe("nhentai resolveUrl", () => {
  test("declares its site", () => {
    expect(nhentai(host().caps).info.linkHosts).toEqual(["nhentai.net"]);
  });

  test("opens a gallery or one of its pages without fetching", async () => {
    const { caps, sent } = host();
    const bridge = nhentai(caps);
    expect(await bridge.resolveUrl!("https://nhentai.net/g/177013/")).toEqual({ seriesId: "177013" });
    expect(await bridge.resolveUrl!("https://nhentai.net/g/177013/5/")).toEqual({ seriesId: "177013" });
    expect(sent).toEqual([]);
  });

  test("ignores other pages", async () => {
    const bridge = nhentai(host().caps);
    expect(await bridge.resolveUrl!("https://nhentai.net/tag/glasses/")).toBeNull();
    expect(await bridge.resolveUrl!("https://nhentai.net/search/?q=x")).toBeNull();
  });
});
