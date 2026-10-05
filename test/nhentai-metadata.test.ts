/**
 * The descriptive extras on an nhentai gallery: the titles that aren't the one shown →
 * `altTitles`, and the print-only facts (favorites, upload date) → `infoCells`.
 *
 * Instantiates the bridge directly with a mock host serving one gallery detail (no network, no build).
 */
import { describe, expect, test } from "bun:test";
import { type HostCapabilities, type HttpRequest, type HttpResponse, seriesInfoSchema } from "@comical/contract";
import factory from "../src/nhentai.ts";

function detailHost(gallery: Record<string, unknown>): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const path = new URL(req.url).pathname;
        const body = path.endsWith("/cdn")
          ? JSON.stringify({ image_servers: ["https://i.example"], thumb_servers: ["https://t.example"] })
          : JSON.stringify({ id: 1, media_id: "m1", title: { english: "[Circle] Subject [English]" }, num_pages: 10, ...gallery });
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

const details = (gallery: Record<string, unknown>) => factory(detailHost(gallery)).getSeriesDetails("1");

describe("nhentai alternate titles", () => {
  test("the Japanese and short titles, in that order", async () => {
    const info = await details({
      title: { english: "[Circle] Subject [English]", japanese: "[サークル] 主題", pretty: "Subject" },
    });
    expect(info.title).toBe("[Circle] Subject [English]");
    expect(info.altTitles).toEqual(["[サークル] 主題", "Subject"]);
  });

  test("a title that is the one shown is not repeated", async () => {
    // No English title: `pretty` is what's shown, so only the Japanese one is left over.
    const info = await details({ title: { japanese: "主題", pretty: "Subject" } });
    expect(info.title).toBe("Subject");
    expect(info.altTitles).toEqual(["主題"]);
  });

  test("blanks and repeats are dropped; nothing left means no field", async () => {
    expect((await details({ title: { english: "Subject", japanese: "主題", pretty: " 主題 " } })).altTitles).toEqual(["主題"]);
    expect((await details({ title: { english: "Subject", japanese: " ", pretty: "Subject" } })).altTitles).toBeUndefined();
    expect((await details({})).altTitles).toBeUndefined();
  });
});

describe("nhentai info cells", () => {
  test("favorites with thousands separators, then the upload date (UTC)", async () => {
    const info = await details({ num_favorites: 8676, upload_date: 1376110208 });
    expect(info.infoCells).toEqual([
      { label: "Favorites", value: "8,676" },
      { label: "Uploaded", value: "2013-08-10" },
    ]);
  });

  test("separators land every three digits", async () => {
    const favorites = async (n: number) => (await details({ num_favorites: n })).infoCells?.[0]?.value;
    expect(await favorites(999)).toBe("999");
    expect(await favorites(1000)).toBe("1,000");
    expect(await favorites(1234567)).toBe("1,234,567");
  });

  test("omitted when the gallery reports neither, or zero", async () => {
    expect((await details({})).infoCells).toBeUndefined();
    expect((await details({ num_favorites: 0, upload_date: 0 })).infoCells).toBeUndefined();
  });

  test("the whole detail still validates against the contract", async () => {
    const info = await details({
      title: { english: "Subject", japanese: "主題", pretty: "Subject" },
      num_favorites: 12,
      upload_date: 1376110208,
    });
    expect(seriesInfoSchema.safeParse(info).success).toBe(true);
  });
});
