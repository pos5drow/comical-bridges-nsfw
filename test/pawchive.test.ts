/**
 * Pawchive on the kemono engine, against API responses captured Nov 2026 with the bridge's honest
 * User-Agent (post titles replaced with placeholders; the last attachment is synthetic, shaped like
 * a real preview-only file): the creator list, a profile, posts, and an unwrapped post's files at
 * full size from their own servers or a signed link.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import pawchive from "../src/pawchive.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "pawchive", name), "utf8");
const ID = "fanbox/37736420";

function host(settings: Record<string, string> = {}) {
  const requests: HttpRequest[] = [];
  const caps: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        requests.push(req);
        const p = new URL(req.url).pathname;
        const body =
          p === "/api/v1/creators" ? fixture("creators.json")
          : p.endsWith("/profile") ? fixture("profile.json")
          : p.endsWith("/posts") ? fixture("posts.json")
          : fixture("post.json");
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings,
  };
  return { caps, requests };
}

test("an honest User-Agent and the site's limits", async () => {
  const { caps, requests } = host();
  const bridge = pawchive(caps);
  await bridge.getListItems!("popular");
  expect(requests[0]!.headers?.["User-Agent"]).toStartWith("ComicalBridge/");
  expect(requests[0]!.headers?.Accept).toBe("text/css");
  expect(bridge.info).toMatchObject({ id: "pos5drow.pawchive", nsfw: true, rateLimit: { minIntervalMs: 1000 }, assetRateLimit: { maxConcurrent: 4, minIntervalMs: 1000 } });
});

describe("creators and posts", () => {
  test("lists from the creator list, icons on the main host", async () => {
    const res = await pawchive(host().caps).getListItems!("popular");
    const creators = JSON.parse(fixture("creators.json")) as { name: string; favorited: number }[];
    expect(res.items.map((e) => e.title)).toEqual([...creators].sort((a, b) => b.favorited - a.favorited).map((c) => c.name));
    expect(res.items.find((e) => e.id === ID)!.thumbnailUrl).toBe("https://pawchive.pw/icons/fanbox/37736420");
  });

  test("details and chapters", async () => {
    const bridge = pawchive(host().caps);
    const info = await bridge.getSeriesDetails(ID);
    expect(info).toMatchObject({ id: ID, title: "Anna Anon", shareUrl: "https://pawchive.pw/fanbox/user/37736420" });
    const chapters = await bridge.getChapters!(ID);
    expect(chapters.map((c) => c.name)).toEqual(["Post A", "Post B", "Post C"]);
  });

  test("pages at full size by default: the file's own server, or the signed link for a preview-only file", async () => {
    const pages = await pawchive(host().caps).getChapterPages!(ID, "12895469");
    const post = JSON.parse(fixture("post.json"));
    expect(pages[0]!.imageUrl).toBe(`${post.file.server}/data${post.file.path}`);
    expect(pages.at(-1)!.imageUrl).toBe("https://t2.pawchive.pw/f/befee555415efc87/preview.jpg?e=1794759500&s=synthetic");
    expect(pages.every((p) => p.thumbnail?.kind === "image" && p.thumbnail.url.startsWith("https://img.pawchive.pw/thumbnail/data/"))).toBe(true);
    const thumbs = await pawchive(host({ images: "thumbnail" }).caps).getChapterPages!(ID, "12895469");
    expect(thumbs[0]!.imageUrl).toBe(`https://img.pawchive.pw/thumbnail/data${post.file.path}`);
  });
});

test("links on its domains", async () => {
  const bridge = pawchive(host().caps);
  expect(await bridge.resolveUrl!("https://pawchive.pw/fanbox/user/37736420/post/12895469")).toEqual({ seriesId: ID, chapterId: "12895469" });
  expect(await bridge.resolveUrl!("https://kemono.cr/fanbox/user/37736420")).toBeNull();
});
