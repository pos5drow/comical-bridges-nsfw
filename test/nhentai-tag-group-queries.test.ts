/**
 * Every nhentai tag group must be tappable. The host only acts on a chip whose group carries
 * `tagIds` (select the tag filter) or `tagQueries` (run that free-text search); a group of bare
 * names renders dead chips — which is exactly what Characters / Parodies / Languages were, so
 * tapping a character did nothing. Each non-id tag type maps to the search-box prefix nhentai's
 * /api/v2/search understands, and getSearchResults passes free text straight through.
 *
 * Instantiates the bridge directly with a mock host serving one gallery detail (no network, no build).
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/nhentai.ts";

type Tag = { id: number | null; type: string; name: string };

function detailHost(tags: Tag[], urls: string[] = []): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        urls.push(req.url);
        const path = new URL(req.url).pathname;
        const body = path.endsWith("/cdn")
          ? JSON.stringify({ image_servers: ["https://i.example"], thumb_servers: ["https://t.example"] })
          : path.endsWith("/search")
            ? JSON.stringify({ result: [], num_pages: 0 })
            : JSON.stringify({ id: 1, media_id: "m1", title: { english: "G1" }, cover: { path: "galleries/1/cover.webp" }, tags, num_pages: 10 });
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

const ALL_TYPES: Tag[] = [
  { id: 10, type: "tag", name: "big breasts" },
  { id: 11, type: "character", name: "hinata hyuga" },
  { id: 12, type: "parody", name: "naruto" },
  { id: 13, type: "group", name: "Group G" },
  { id: 14, type: "language", name: "english" },
  { id: 15, type: "artist", name: "Artist A" },
  { id: 16, type: "category", name: "doujinshi" },
];

describe("nhentai tag groups are all actionable", () => {
  test("every emitted group carries tagIds or tagQueries (no dead chips)", async () => {
    const info = await factory(detailHost(ALL_TYPES)).getSeriesDetails("1");
    const groups = info.tagGroups ?? [];
    expect(groups.map((g) => g.label)).toEqual(["Tags", "Characters", "Parodies", "Groups", "Languages"]);
    for (const g of groups) {
      const actionable = g.tagIds ?? g.tagQueries;
      expect(actionable, `${g.label} has no tagIds/tagQueries`).toBeDefined();
      expect(actionable).toHaveLength(g.tags.length);
    }
  });

  test("characters, parodies and languages search by their nhentai prefix", async () => {
    const info = await factory(detailHost(ALL_TYPES)).getSeriesDetails("1");
    const q = (label: string) => info.tagGroups?.find((g) => g.label === label)?.tagQueries;
    expect(q("Characters")).toEqual(['character:"hinata hyuga"']);
    expect(q("Parodies")).toEqual(['parody:"naruto"']);
    expect(q("Groups")).toEqual(['group:"Group G"']);
    expect(q("Languages")).toEqual(['language:"english"']);
  });

  test("content tags keep their filterable ids (host selects the tag filter, not a query)", async () => {
    const info = await factory(detailHost(ALL_TYPES)).getSeriesDetails("1");
    const tags = info.tagGroups?.find((g) => g.label === "Tags");
    expect(tags?.tagIds).toEqual(["10"]);
    expect(tags?.tagQueries).toBeUndefined();
  });

  test("a content tag without an id falls back to a tag:\"…\" query instead of going dead", async () => {
    const info = await factory(detailHost([
      { id: 10, type: "tag", name: "big breasts" },
      { id: null, type: "tag", name: "no id" },
    ])).getSeriesDetails("1");
    const tags = info.tagGroups?.find((g) => g.label === "Tags");
    expect(tags?.tagIds).toBeUndefined();
    expect(tags?.tagQueries).toEqual(['tag:"big breasts"', 'tag:"no id"']);
  });

  test("a character chip's query round-trips through getSearchResults verbatim", async () => {
    const urls: string[] = [];
    const bridge = factory(detailHost(ALL_TYPES, urls));
    const info = await bridge.getSeriesDetails("1");
    const query = info.tagGroups!.find((g) => g.label === "Characters")!.tagQueries![0]!;
    await bridge.getSearchResults({ text: query });
    const search = urls.map((u) => new URL(u)).find((u) => u.pathname.endsWith("/search"))!;
    expect(search.searchParams.get("query")).toBe('character:"hinata hyuga"');
  });
});
