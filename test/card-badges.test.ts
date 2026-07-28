/**
 * Card badges (contract: seriesEntry.badges) the bridges paint onto the bottom of list/search cards,
 * with languages shown as terse abbreviations ("EN", "JP"):
 *  - nhentai: the gallery language only, read from the inline `tag_ids` already on every list item.
 *  - e-hentai: the gallery type (category) plus the primary language, from gdata metadata.
 * nhentai is exercised end-to-end through getListItems; e-hentai's pure `cardBadges` helper is tested
 * directly (its listing path needs a live HTML+gdata round-trip covered elsewhere).
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import nhentaiFactory from "../src/nhentai.ts";
import { cardBadges } from "../src/ehentai.ts";

// nhentai language tag ids: 12227 = english, 6346 = japanese.
const G_EN = { id: 1, media_id: "m1", english_title: "English One", thumbnail: "galleries/1/thumb.webp", tag_ids: [12227, 5] };
const G_JP = { id: 2, media_id: "m2", english_title: "Japanese Two", thumbnail: "galleries/2/thumb.webp", tag_ids: [6346] };
const G_NONE = { id: 3, media_id: "m3", english_title: "No Lang", thumbnail: "galleries/3/thumb.webp", tag_ids: [7, 8] };

function nhentaiHost(): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const path = new URL(req.url).pathname;
        const body = path.endsWith("/cdn")
          ? JSON.stringify({ image_servers: ["https://i.example"], thumb_servers: ["https://t.example"] })
          : JSON.stringify([G_EN, G_JP, G_NONE]); // Popular Now returns a bare array
        return { url: req.url, status: 200, statusText: "OK", headers: {}, body };
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

describe("nhentai card language badge", () => {
  test("tags each card with its language only, from inline tag_ids", async () => {
    const bridge = nhentaiFactory(nhentaiHost());
    const { items } = await bridge.getListItems("popular-now", 1);
    expect(items[0]!.badges).toEqual([{ text: "EN", position: "bottom-right", tone: "info" }]);
    expect(items[1]!.badges).toEqual([{ text: "JP", position: "bottom-right", tone: "info" }]);
    // No language tag → no badge at all.
    expect(items[2]!.badges).toBeUndefined();
  });
});

describe("e-hentai card type + language badges", () => {
  test("category (top-left) and primary language (top-right), skipping translation modifiers", () => {
    const badges = cardBadges({
      gid: 1,
      token: "t",
      title: "X",
      category: "Doujinshi",
      tags: ["language:english", "language:translated", "artist:someone"],
    });
    expect(badges).toEqual([
      { text: "Doujinshi", position: "bottom-left", tone: "neutral" },
      { text: "EN", position: "bottom-right", tone: "info" },
    ]);
  });

  test("category alone when no language is tagged", () => {
    expect(cardBadges({ gid: 1, token: "t", title: "X", category: "Manga", tags: [] })).toEqual([
      { text: "Manga", position: "bottom-left", tone: "neutral" },
    ]);
  });

  test("language alone when only modifier languages are present is skipped (no language badge)", () => {
    expect(cardBadges({ gid: 1, token: "t", title: "X", category: "Manga", tags: ["language:translated"] })).toEqual([
      { text: "Manga", position: "bottom-left", tone: "neutral" },
    ]);
  });

  test("an unknown language falls back to its first two letters uppercased", () => {
    expect(cardBadges({ gid: 1, token: "t", title: "X", category: "Manga", tags: ["language:swahili"] })).toEqual([
      { text: "Manga", position: "bottom-left", tone: "neutral" },
      { text: "SW", position: "bottom-right", tone: "info" },
    ]);
  });
});
