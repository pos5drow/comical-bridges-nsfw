/**
 * Regression: hitomi gg.js polarity.
 *
 * Page images live on `w1`/`w2` (`a1`/`a2`), chosen by `1 + gg.m(g)`. hitomi rotates gg.js between
 * `var o = 0` with cases setting `o = 1`, and `var o = 1` with cases setting `o = 0`. The bridge used to
 * assume the first shape, so whenever the site flipped to the second every page URL pointed at the
 * wrong subdomain and 404'd — "the pages only load sometimes".
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory, { parseGg } from "../src/hitomi.ts";

// g = parseInt(last char + previous two, 16): "…" + "01" + "0" → 0x001 = 1; "…" + "02" + "0" → 2.
const H_CASE = "0".repeat(61) + "010";
const H_DEFAULT = "0".repeat(61) + "020";

const GG_DEFAULT_0 = "'use strict';\ngg = { m: function(g) {\nvar o = 0;\nswitch (g) {\ncase 1:\ncase 5:\no = 1; break;\n}\nreturn o;\n},\nb: '1700000000/'\n};";
const GG_DEFAULT_1 = "'use strict';\ngg = { m: function(g) {\nvar o = 1;\nswitch (g) {\ncase 1:\ncase 5:\no = 0; break;\n}\nreturn o;\n},\nb: '1700000000/'\n};";

function host(gg: string): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const ok = (body: string): HttpResponse => ({ url: req.url, status: 200, statusText: "OK", headers: {}, body });
        if (req.url.endsWith("/gg.js")) return ok(gg);
        return ok(
          "var galleryinfo = " +
            JSON.stringify({ id: "1", title: "Subject", files: [{ name: "1.webp", hash: H_CASE }, { name: "2.webp", hash: H_DEFAULT }] }),
        );
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

function unproxy(u: string): string {
  const m = u.match(/\/img-proxy\?url=(.+)$/);
  return m ? decodeURIComponent(m[1]!) : u;
}

describe("hitomi gg.js", () => {
  test("parseGg reads the default and the case value, whichever way round", () => {
    const a = parseGg(GG_DEFAULT_0);
    expect(a.def).toBe(0);
    expect(a.cases.get(1)).toBe(1);
    expect(a.cases.get(5)).toBe(1);
    expect(a.b).toBe("1700000000/");

    const b = parseGg(GG_DEFAULT_1);
    expect(b.def).toBe(1);
    expect(b.cases.get(1)).toBe(0);
    expect(b.cases.has(2)).toBe(false);
  });

  test("page subdomains follow gg.m in the default-0 shape", async () => {
    const [p0, p1] = await factory(host(GG_DEFAULT_0)).getSeriesPages!("1");
    expect(unproxy(p0!.imageUrl)).toStartWith("https://w2."); // case → 1
    expect(unproxy(p1!.imageUrl)).toStartWith("https://w1."); // default → 0
  });

  test("page subdomains follow gg.m in the inverted default-1 shape", async () => {
    const [p0, p1] = await factory(host(GG_DEFAULT_1)).getSeriesPages!("1");
    expect(unproxy(p0!.imageUrl)).toStartWith("https://w1."); // case → 0
    expect(unproxy(p1!.imageUrl)).toStartWith("https://w2."); // default → 1
    expect(unproxy(p1!.imageUrl)).toBe(`https://w2.gold-usergeneratedcontent.net/1700000000/2/${H_DEFAULT}.webp`);
  });
});
