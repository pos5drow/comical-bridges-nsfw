/**
 * The descriptive extras on an e-hentai gallery's gdata: the Japanese title → `altTitles`, the
 * 0–5 star `rating` → the contract's 0–1 `rating`, and the print-only facts (posted date, total
 * size) → `infoCells`. Also the bridge-level `ratings` declaration that lets a client show a
 * rating at all.
 *
 * Instantiates the bridge with a mock host answering the gdata call with canned JSON.
 */
import { describe, expect, test } from "bun:test";
import { type HostCapabilities, type HttpRequest, type HttpResponse, seriesInfoSchema } from "@comical/contract";
import factory from "../src/ehentai.ts";

function gdataHost(meta: Record<string, unknown>): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const body = JSON.stringify({ gmetadata: [{ gid: 1, token: "abc", title: "Subject Gallery", ...meta }] });
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

const details = (meta: Record<string, unknown>) => factory(gdataHost(meta)).getSeriesDetails("1:abc");

describe("e-hentai alternate titles", () => {
  test("the Japanese title is an alternate title, not the description", async () => {
    const info = await details({ title_jpn: "主題のギャラリー" });
    expect(info.altTitles).toEqual(["主題のギャラリー"]);
    expect(info.description).toBeUndefined();
  });

  test("omitted when it is blank, missing, or the title again", async () => {
    expect((await details({})).altTitles).toBeUndefined();
    expect((await details({ title_jpn: "   " })).altTitles).toBeUndefined();
    expect((await details({ title_jpn: " Subject Gallery " })).altTitles).toBeUndefined();
  });
});

describe("e-hentai rating", () => {
  test("declares ratings on the bridge", () => {
    expect(factory(gdataHost({})).info.ratings).toBe(true);
  });

  test("normalizes the 0–5 stars to 0–1, with no vote count", async () => {
    const info = await details({ rating: "4.55" });
    expect(info.rating?.score).toBeCloseTo(0.91, 5);
    expect(info.rating?.votes).toBeUndefined();
  });

  test("an unrated or unreadable rating is no rating", async () => {
    expect((await details({ rating: "0.00" })).rating).toBeUndefined();
    expect((await details({ rating: "n/a" })).rating).toBeUndefined();
    expect((await details({})).rating).toBeUndefined();
  });

  test("never exceeds 1", async () => {
    expect((await details({ rating: "5.01" })).rating?.score).toBe(1);
  });
});

describe("e-hentai info cells", () => {
  test("posted date (UTC) then total size", async () => {
    const info = await details({ posted: "1376110208", filesize: 51210504 });
    expect(info.infoCells).toEqual([
      { label: "Posted", value: "2013-08-10" },
      { label: "Size", value: "48.8 MB" },
    ]);
  });

  test("size picks its unit", async () => {
    const size = async (filesize: number) => (await details({ filesize })).infoCells?.[0]?.value;
    expect(await size(512)).toBe("512 B");
    expect(await size(1536)).toBe("1.5 KB");
    expect(await size(300 * 1024 * 1024)).toBe("300 MB");
    expect(await size(5 * 1024 ** 3)).toBe("5.0 GB");
  });

  test("omitted when the gallery reports neither, or reports junk", async () => {
    expect((await details({})).infoCells).toBeUndefined();
    expect((await details({ posted: "soon", filesize: 0 })).infoCells).toBeUndefined();
  });

  test("the whole detail still validates against the contract", async () => {
    const info = await details({ title_jpn: "主題", rating: "3.5", posted: "1376110208", filesize: 2048, filecount: "20" });
    expect(seriesInfoSchema.safeParse(info).success).toBe(true);
  });
});
