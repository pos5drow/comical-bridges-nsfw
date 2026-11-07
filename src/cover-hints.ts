import type { SeriesEntry } from "@comical/sdk";

/** What a series is as an object, and how it reads — the contract's two cover hints. */
export type CoverHints = Pick<SeriesEntry, "coverForm" | "readingDirection">;

/**
 * The cover hints a gallery's CATEGORY gives, as the gallery sites name it ("Artist CG", "artistcg",
 * "Non-H" and "nonh" alike): a doujinshi is a thin stapled issue and a manga a volume, both read
 * right to left; a Western comic an issue read left to right; a Non-H gallery an issue; and the
 * picture sets — artist and game CGs, image sets, cosplay and photo sets, Hitomi's anime, and
 * E-Hentai's Misc, which is mostly loose pictures — sheets, which bind on no edge and so say nothing
 * of a direction. Anything unknown says nothing, and the app guesses.
 */
export function hintsForCategory(category: string | undefined): CoverHints {
  switch (category?.toLowerCase().replace(/[\s_-]+/g, "")) {
    case "doujinshi":
      return { coverForm: "issue", readingDirection: "rtl" };
    case "manga":
      return { coverForm: "volume", readingDirection: "rtl" };
    case "western":
      return { coverForm: "issue", readingDirection: "ltr" };
    case "nonh":
      return { coverForm: "issue" };
    case "artistcg":
    case "gamecg":
    case "imageset":
    case "cosplay":
    case "asianporn":
    case "anime":
    case "misc":
      return { coverForm: "sheets" };
    default:
      return {};
  }
}
