/**
 * Unit test for e-hentai tag → search-query metadata. `getSeriesDetails` attaches `tagQueries`
 * (parallel to `tags`) carrying the exact e-hentai search token for each tag, so a host can drop it
 * straight into the search box on tag click. The mock host answers the gdata API with canned metadata;
 * no network, no build step.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/ehentai.ts";

/** A host that answers the gdata API POST with canned metadata for one gallery. */
function gdataHost(tags: string[]): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const ok = (body: string): HttpResponse => ({ url: req.url, status: 200, statusText: "OK", headers: {}, body });
        if (req.url.includes("api.e-hentai.org")) {
          return ok(JSON.stringify({ gmetadata: [{ gid: 123, token: "abc", title: "A Gallery", tags }] }));
        }
        return ok("{}");
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

describe("e-hentai tagQueries", () => {
  test("attaches an exact-match search token parallel to each tag, and no tagIds", async () => {
    const info = await factory(gdataHost(["female:big breasts", "artist:foo", "other:plot"])).getSeriesDetails("123:abc");
    const groups = info.tagGroups ?? [];

    const female = groups.find((g) => g.label === "Female Tags");
    expect(female?.tags).toEqual(["big breasts"]);
    expect(female?.tagQueries).toEqual(['female:"big breasts$"']);

    const artist = groups.find((g) => g.label === "Artists");
    expect(artist?.tagQueries).toEqual(['artist:"foo$"']);

    // "other" namespace has no NS_LABELS entry, so its label is the capitalized namespace.
    const other = groups.find((g) => g.label === "Other");
    expect(other?.tagQueries).toEqual(['other:"plot$"']);

    // tagQueries length always matches tags; the click path uses queries, not ids.
    for (const g of groups) {
      expect(g.tagQueries?.length).toBe(g.tags.length);
      expect(g.tagIds).toBeUndefined();
    }
  });

  test("colon-less tags (the 'misc' bucket) search unscoped", async () => {
    const info = await factory(gdataHost(["uncategorized"])).getSeriesDetails("123:abc");
    const misc = (info.tagGroups ?? []).find((g) => g.label === "Misc");
    expect(misc?.tags).toEqual(["uncategorized"]);
    expect(misc?.tagQueries).toEqual(['"uncategorized$"']);
  });

  test("the language namespace stays out of tag groups (surfaced via info.languages)", async () => {
    const info = await factory(gdataHost(["language:english", "female:big breasts"])).getSeriesDetails("123:abc");
    expect(info.languages).toEqual(["english"]);
    expect((info.tagGroups ?? []).some((g) => g.label === "Languages")).toBe(false);
  });
});
