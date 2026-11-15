/**
 * Kemono against API responses captured Nov 2026: the creator list cut to five (one Discord, which is
 * left out), a Fanbox creator's profile and posts (post titles replaced with placeholders; the last
 * post is synthetic, text only), and one post's files. Every API call sends `Accept: text/css`, as the
 * site asks scripts to.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import { nextPageCursor } from "@comical/sdk";
import kemono from "../src/kemono.ts";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "kemono", name), "utf8");
const ID = "fanbox/3316400";

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
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [], secure: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] } },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings,
  };
  return { caps, requests };
}

describe("creators", () => {
  test("most favorited, from the creator list fetched once, Discord left out", async () => {
    const { caps, requests } = host();
    const bridge = kemono(caps);
    const res = await bridge.getListItems!("popular");
    await bridge.getListItems!("updated");
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual(["/api/v1/creators"]);
    expect(requests[0]!.headers?.Accept).toBe("text/css");
    expect(res.items.map((e) => e.id)).toEqual(["patreon/5564244", "patreon/3295915", ID, "gumroad/8654432876728"]);
    expect(res.items[2]).toEqual({ id: ID, title: "MだSたろう", subtitle: "Pixiv Fanbox", thumbnailUrl: "https://img.kemono.cr/icons/fanbox/3316400" });
    expect(res.nextCursor).toBeUndefined();
  });

  test("search by name and service, sorted", async () => {
    const bridge = kemono(host().caps);
    expect((await bridge.getSearchResults!({ text: "maple" })).items.map((e) => e.id)).toEqual(["patreon/3295915"]);
    const patreon = await bridge.getSearchResults!({ text: "", filters: [{ key: "service", value: { include: ["patreon"], exclude: [] } }], sort: { key: "title", ascending: true } });
    expect(patreon.items.map((e) => e.title)).toEqual(["Maplestar", "theobrobine"]);
    const noPatreon = await bridge.getSearchResults!({ text: "", filters: [{ key: "service", value: { include: [], exclude: ["patreon"] } }] });
    expect(noPatreon.items.map((e) => e.id)).toEqual([ID, "gumroad/8654432876728"]);
    expect((await bridge.getSearchResults!({ text: "", cursor: nextPageCursor(1, true)! })).items).toEqual([]);
  });
});

describe("a creator", () => {
  test("details from the profile", async () => {
    const info = await kemono(host().caps).getSeriesDetails(ID);
    expect(info).toMatchObject({ id: ID, title: "MだSたろう", author: "MだSたろう", shareUrl: "https://kemono.cr/fanbox/user/3316400", description: "711 posts archived from Pixiv Fanbox." });
  });

  test("posts with images are chapters; untitled ones named by date", async () => {
    const { caps, requests } = host({ posts: "50" });
    const chapters = await kemono(caps).getChapters!(ID);
    expect(requests.map((r) => new URL(r.url).search)).toEqual(["?o=0"]);
    expect(chapters.map((c) => c.name)).toEqual(["Post A", "Post from 2026-01-11", "Post C", "Post D"]);
    expect(chapters[0]).toEqual({ id: "11274708", name: "Post A", publishedAt: Date.UTC(2026, 0, 21, 7, 59, 42) });
  });

  test("pages: thumbnails by default, full size by setting, file and attachments once each", async () => {
    const thumbs = await kemono(host().caps).getChapterPages!(ID, "11221992");
    expect(thumbs).toHaveLength(3);
    expect(thumbs[0]!.imageUrl).toBe("https://img.kemono.cr/thumbnail/data/56/59/5659322596da72eb14177b995d56fec62616cc47cd3dfb31c91c24944f738936.jpg");
    const full = await kemono(host({ images: "full" }).caps).getChapterPages!(ID, "11221992");
    expect(full[0]!.imageUrl).toBe("https://kemono.cr/data/56/59/5659322596da72eb14177b995d56fec62616cc47cd3dfb31c91c24944f738936.jpg?f=SZiJLBY4rfqqldOEU0T5p0vg.jpeg");
    expect(full[0]!.thumbnail).toEqual({ kind: "image", url: thumbs[0]!.imageUrl });
  });

  test("a malformed id is gone", async () => {
    await expect(kemono(host().caps).getSeriesDetails("nope")).rejects.toThrow(/removed from the source/);
  });
});

test("links: creators and posts; Discord isn't offered", async () => {
  const bridge = kemono(host().caps);
  expect(await bridge.resolveUrl!("https://kemono.cr/fanbox/user/3316400")).toEqual({ seriesId: ID });
  expect(await bridge.resolveUrl!("https://kemono.su/fanbox/user/3316400/post/11221992")).toEqual({ seriesId: ID, chapterId: "11221992" });
  expect(await bridge.resolveUrl!("https://kemono.cr/discord/server/1")).toBeNull();
});
