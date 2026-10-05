/**
 * The descriptive extras on a hitomi gallery: the Japanese title → `altTitles`, and its two dates
 * → `infoCells`. Both used to be lines of the composed description, which now keeps only the
 * credits it was written for.
 *
 * Instantiates the bridge with a mock host answering `galleries/{id}.js` + `gg.js` — no network.
 */
import { describe, expect, test } from "bun:test";
import { type HostCapabilities, type HttpRequest, type HttpResponse, seriesInfoSchema } from "@comical/contract";
import factory from "../src/hitomi.ts";

const HASH = "0000000000000000000000000000000000000000000000000000000000000abc";

function galleryHost(gallery: Record<string, unknown>): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const ok = (body: string): HttpResponse => ({ url: req.url, status: 200, statusText: "OK", headers: {}, body });
        if (req.url.endsWith("/gg.js")) return ok("gg = { m: function(g){ return 0; }, b: '1700000000/' };");
        return ok(
          "var galleryinfo = " +
            JSON.stringify({ id: "1", title: "Subject", files: [{ name: "1.webp", hash: HASH }], ...gallery }),
        );
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

const details = (gallery: Record<string, unknown>) => factory(galleryHost(gallery)).getSeriesDetails("1");

describe("hitomi alternate titles", () => {
  test("the Japanese title is an alternate title", async () => {
    expect((await details({ japanese_title: "主題" })).altTitles).toEqual(["主題"]);
  });

  test("omitted when it is null, blank, or the title again", async () => {
    expect((await details({})).altTitles).toBeUndefined();
    expect((await details({ japanese_title: null })).altTitles).toBeUndefined();
    expect((await details({ japanese_title: "  " })).altTitles).toBeUndefined();
    expect((await details({ japanese_title: "Subject" })).altTitles).toBeUndefined();
  });
});

describe("hitomi info cells", () => {
  test("published then added, as dates", async () => {
    const info = await details({ datepublished: "2021-03-04", date: "2023-05-14 08:12:00-05" });
    expect(info.infoCells).toEqual([
      { label: "Published", value: "2021-03-04" },
      { label: "Added", value: "2023-05-14" },
    ]);
  });

  test("omitted when the gallery has neither date", async () => {
    expect((await details({ datepublished: null })).infoCells).toBeUndefined();
  });
});

describe("hitomi description", () => {
  test("no longer repeats the Japanese title or the dates", async () => {
    const info = await details({
      japanese_title: "主題",
      datepublished: "2021-03-04",
      date: "2023-05-14 08:12:00-05",
      groups: [{ group: "Circle C" }],
    });
    expect(info.description).toBe("Circle: Circle C");
  });

  test("absent when those were all it had", async () => {
    const info = await details({ japanese_title: "主題", date: "2023-05-14 08:12:00-05" });
    expect(info.description).toBeUndefined();
  });

  test("the whole detail still validates against the contract", async () => {
    const info = await details({ japanese_title: "主題", datepublished: "2021-03-04", date: "2023-05-14 08:12:00-05" });
    expect(seriesInfoSchema.safeParse(info).success).toBe(true);
  });
});
