/**
 * Authors vs groups on nhentai. nhentai models artists and groups as distinct tag types; a gallery
 * may have one, the other, or both. Authors must come from ARTISTS only — a group presented as the
 * author breaks the credit tap, which searches `artist:"<name>"` (see getSearchResults) and can't
 * match a group. Groups get their own chip group whose `tagQueries` search `group:"…"` instead.
 *
 * Instantiates the bridge directly with a mock host serving one gallery detail (no network, no build).
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/nhentai.ts";

type Tag = { id: number; type: string; name: string };

function detailHost(tags: Tag[]): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const path = new URL(req.url).pathname;
        const body = path.endsWith("/cdn")
          ? JSON.stringify({ image_servers: ["https://i.example"], thumb_servers: ["https://t.example"] })
          : JSON.stringify({ id: 1, media_id: "m1", title: { english: "G1" }, cover: { path: "galleries/1/cover.webp" }, tags, num_pages: 10 });
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

const groupsGroup = (info: Awaited<ReturnType<ReturnType<typeof factory>["getSeriesDetails"]>>) =>
  info.tagGroups?.find((g) => g.label === "Groups");

describe("nhentai credits", () => {
  test("artist present → author is the artist, not the group", async () => {
    const bridge = factory(detailHost([
      { id: 1, type: "artist", name: "Artist A" },
      { id: 2, type: "group", name: "Group G" },
    ]));
    const info = await bridge.getSeriesDetails("1");
    expect(info.author).toBe("Artist A");
    expect(info.authors?.map((a) => a.name)).toEqual(["Artist A"]);
    // Group is a distinct, group-searchable chip — never folded into the author.
    expect(groupsGroup(info)?.tags).toEqual(["Group G"]);
    expect(groupsGroup(info)?.tagQueries).toEqual(['group:"Group G"']);
  });

  test("group-only gallery → NO author (previously the group leaked into the author)", async () => {
    const bridge = factory(detailHost([{ id: 2, type: "group", name: "Group G" }]));
    const info = await bridge.getSeriesDetails("1");
    expect(info.author).toBeUndefined();
    expect(info.authors).toBeUndefined();
    // Still surfaced — and tapping it searches as a group.
    expect(groupsGroup(info)?.tagQueries).toEqual(['group:"Group G"']);
  });

  test("multiple artists join into the author line", async () => {
    const bridge = factory(detailHost([
      { id: 1, type: "artist", name: "A One" },
      { id: 3, type: "artist", name: "A Two" },
    ]));
    const info = await bridge.getSeriesDetails("1");
    expect(info.author).toBe("A One, A Two");
    // Name-only credits: nhentai has no stable per-author id, and its author filter matches on the
    // name itself — so the host must get bare names, never a fabricated id it would filter by.
    expect(info.authors).toEqual([{ name: "A One" }, { name: "A Two" }]);
    expect(groupsGroup(info)).toBeUndefined();
  });
});
