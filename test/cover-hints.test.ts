/**
 * The contract's cover hints from a gallery's category, as E-Hentai, nhentai and Hitomi each spell
 * it: what the gallery is as an object (a stapled issue, a volume, sheets of pictures) and which way
 * it reads. The app draws a gallery's card from them.
 */
import { describe, expect, test } from "bun:test";
import { hintsForCategory } from "../src/cover-hints.ts";

describe("cover hints from a gallery's category", () => {
  test("a doujinshi is an issue and a manga a volume, both read right to left", () => {
    expect(hintsForCategory("Doujinshi")).toEqual({ coverForm: "issue", readingDirection: "rtl" });
    expect(hintsForCategory("manga")).toEqual({ coverForm: "volume", readingDirection: "rtl" });
  });

  test("a Western comic is an issue read left to right; a Non-H gallery an issue", () => {
    expect(hintsForCategory("Western")).toEqual({ coverForm: "issue", readingDirection: "ltr" });
    expect(hintsForCategory("Non-H")).toEqual({ coverForm: "issue" });
    expect(hintsForCategory("nonh")).toEqual({ coverForm: "issue" });
  });

  test("picture sets are sheets, and bind on no edge", () => {
    // E-Hentai's names, then Hitomi's and nhentai's slugs.
    for (const category of ["Artist CG", "Game CG", "Image Set", "Cosplay", "Asian Porn", "Misc", "artistcg", "gamecg", "imageset", "anime"]) {
      expect(hintsForCategory(category)).toEqual({ coverForm: "sheets" });
    }
  });

  test("an unknown category, or none, says nothing", () => {
    expect(hintsForCategory("Private")).toEqual({});
    expect(hintsForCategory(undefined)).toEqual({});
  });
});
