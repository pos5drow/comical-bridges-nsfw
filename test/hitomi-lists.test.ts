/**
 * hitomi's list catalog: a composed Home (popular rails over a Date Added grid) plus one top-level
 * page per site ordering, each reading its own nozomi index. Random reshuffles per walk and pages
 * one walk consistently.
 *
 * The mock host serves every `.nozomi` as a synthetic descending id list (honouring Range) and
 * every galleryblock as a minimal card — no network.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { type HostCapabilities, type HttpRequest, type HttpResponse, seriesListSchema } from "@comical/contract";
import factory from "../src/hitomi.ts";

const TOTAL_IDS = 100_000;

function listHost(requested: string[]): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        requested.push(req.url);
        const res = (status: number, body: string, headers: Record<string, string> = {}): HttpResponse => ({
          url: req.url,
          status,
          statusText: "",
          headers,
          body,
        });
        if (req.url.endsWith(".nozomi")) {
          const size = TOTAL_IDS * 4;
          const [, from, to] = /bytes=(\d+)-(\d+)/.exec(req.headers?.Range ?? "") ?? [];
          const start = Number(from ?? 0);
          const end = Math.min(Number(to ?? size - 1), size - 1);
          const bytes = new Uint8Array(end - start + 1);
          const view = new DataView(bytes.buffer);
          for (let off = start - (start % 4); off <= end; off += 4) {
            const word = new Uint8Array(4);
            new DataView(word.buffer).setInt32(0, TOTAL_IDS - off / 4, false);
            for (let b = 0; b < 4; b++) if (off + b >= start && off + b <= end) view.setUint8(off + b - start, word[b]!);
          }
          return res(206, Buffer.from(bytes).toString("base64"), { "content-range": `bytes ${start}-${end}/${size}` });
        }
        const block = /galleryblock\/(\d+)\.html$/.exec(req.url);
        if (block) return res(200, `<h1 class="lillie"><a href="/g/${block[1]}.html">Gallery ${block[1]}</a></h1>`);
        return res(404, "");
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

function bridge() {
  const requested: string[] = [];
  return { bridge: factory(listHost(requested)), requested };
}

const nozomiReads = (requested: string[]) =>
  [...new Set(requested.filter((u) => u.endsWith(".nozomi")).map((u) => u.replace(/^https:\/\/[^/]+/, "")))];

const realRandom = Math.random;
afterEach(() => {
  Math.random = realRandom;
});

describe("hitomi list catalog", () => {
  test("top-level pages, in order", async () => {
    const lists = await bridge().bridge.getLists();
    for (const l of lists) expect(seriesListSchema.safeParse(l).success).toBe(true);
    expect(lists.filter((l) => l.page).map((l) => l.name)).toEqual([
      "Date Added",
      "Date Published",
      "Popular Today",
      "Popular Week",
      "Popular Month",
      "Popular Year",
      "Random",
    ]);
  });

  test("Home is the popular rails over a Date Added grid, which comes last", async () => {
    const home = (await bridge().bridge.getLists()).filter((l) => !l.page);
    expect(home.map((l) => [l.name, l.layout])).toEqual([
      ["Popular Today", "hero"],
      ["Popular This Week", "carousel"],
      ["Popular This Month", "carousel"],
      ["Popular This Year", "carousel"],
      ["Date Added", "grid"],
    ]);
  });

  test("exactly one featured list, and it is a Home rail — the bridge still opens on Home", async () => {
    const featured = (await bridge().bridge.getLists()).filter((l) => l.featured);
    expect(featured).toHaveLength(1);
    expect(featured[0]!.page).toBeFalsy();
  });

  test("internal list fields don't leak into the catalog", async () => {
    for (const l of await bridge().bridge.getLists()) {
      expect(l).not.toHaveProperty("sort");
      expect(l).not.toHaveProperty("perPage");
    }
  });
});

describe("hitomi list items", () => {
  const cases: Array<[string, string]> = [
    ["latest", "/index-all.nozomi"],
    ["published", "/date/published-all.nozomi"],
    ["popular-today", "/popular/today-all.nozomi"],
    ["popular-week", "/popular/week-all.nozomi"],
    ["popular-month", "/popular/month-all.nozomi"],
    ["popular-year", "/popular/year-all.nozomi"],
  ];
  for (const [id, path] of cases) {
    test(`${id} reads ${path}, newest/most popular first`, async () => {
      const { bridge: b, requested } = bridge();
      const res = await b.getListItems(id);
      expect(nozomiReads(requested)).toEqual([path]);
      expect(res.items).toHaveLength(24);
      expect(res.items[0]!.id).toBe(String(TOTAL_IDS));
      expect(res.nextCursor).toBeDefined();
    });
  }

  test("a Home rail reads the same ordering as its page, a preview's worth at a time", async () => {
    const { bridge: b, requested } = bridge();
    const rail = await b.getListItems("home-popular-week");
    expect(nozomiReads(requested)).toEqual(["/popular/week-all.nozomi"]);
    expect(rail.items).toHaveLength(12);

    const next = await b.getListItems("home-popular-week", { cursor: rail.nextCursor });
    expect(next.items[0]!.id).toBe(String(TOTAL_IDS - 12));
  });

  test("the Home grid pages a full page at a time", async () => {
    expect((await bridge().bridge.getListItems("home-latest")).items).toHaveLength(24);
  });

  test("an unknown list id throws", async () => {
    await expect(bridge().bridge.getListItems("nope")).rejects.toThrow(/unknown list/);
  });
});

describe("hitomi Random", () => {
  test("a fresh walk reshuffles", async () => {
    const b = bridge().bridge;
    Math.random = () => 0.1;
    const first = (await b.getListItems("random")).items.map((e) => e.id);
    Math.random = () => 0.7;
    const second = (await b.getListItems("random")).items.map((e) => e.id);
    expect(first).toHaveLength(24);
    expect(second).not.toEqual(first);
  });

  test("paging continues one walk: the same cursor gives the same page", async () => {
    const b = bridge().bridge;
    const page1 = await b.getListItems("random");
    expect(page1.nextCursor).toBeDefined();
    Math.random = () => 0.42; // a fresh seed must not be drawn for a cursor that carries one
    const a = (await b.getListItems("random", { cursor: page1.nextCursor })).items.map((e) => e.id);
    const c = (await b.getListItems("random", { cursor: page1.nextCursor })).items.map((e) => e.id);
    expect(a).toHaveLength(24);
    expect(c).toEqual(a);
  });

  test("an unseeded cursor (from before the seed existed) still pages", async () => {
    const { encodeCursor } = await import("@comical/sdk");
    const res = await bridge().bridge.getListItems("random", { cursor: encodeCursor({ page: 2 }) });
    expect(res.items).toHaveLength(24);
  });
});
