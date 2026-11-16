/**
 * MyReadingManga bridge — https://myreadingmanga.info, a WordPress site of BL/yaoi manga,
 * doujinshi and bara, in many languages.
 *  - latest: `/lang/{lang}/[page/{n}/]` (every language: the home page, `/[page/{n}/]`)
 *  - random and search: ElasticPress search, `/page/{n}/?s=…&ep_sort=…&ep_filter_lang=…` plus
 *    `ep_filter_{genre,category,post_tag,status,artist,pairing,group}` facets
 *  - a series is a post (`/{slug}/`); its parts are the post's own pages (`/{slug}/{n}/`, the
 *    `entry-pagination` under the content), and each part is a chapter
 *  - pages: the images in the part's `div.entry-content` (and the lazy `div.separator img[data-src]`)
 *
 * A series id is the post slug; a chapter id is the part number. Video posts (`category-video`)
 * have nothing to read and are left out of every list.
 *
 * One bridge for every language: the Language setting picks which posts the lists and searches show
 * (English by default), and the search's Language filter overrides it for one search. Tag chips on a
 * post run searches in a small `facet:slug` syntax (`genre:bara`, `tag:hairy`, `artist:redgart`)
 * that the search turns back into the site's facet filters.
 *
 * The site sits behind Cloudflare, whose clearance is tied to the User-Agent, so every request
 * sends the host's browser User-Agent when it has one.
 */
import {
  BridgeBase,
  type BridgeInfo,
  type Chapter,
  type CheerioRoot,
  type Filter,
  type HttpRequest,
  type HttpResponse,
  type LinkTarget,
  type ListRequest,
  type Page,
  type PagedResults,
  type SearchRequest,
  type SeriesEntry,
  type SeriesInfo,
  type SeriesList,
  type SettingDescriptor,
  type SortOption,
  type TagGroup,
  defineBridge,
  nextPageCursor,
  pageFromCursor,
  seriesGoneMessage,
} from "@comical/sdk";
import { parseStatus, standardGuards } from "comical-bridge-kit";
import { guardResponse } from "./core/guarded";
import { absoluteUrl, hostOf } from "./core/urls";
import { bridgeIcon } from "./core/icon";

const SITE = "https://myreadingmanga.info";
const FALLBACK_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

/** The site's language slug → [label, BCP 47 code]. Slugs as its `/lang/` archives and facets spell them. */
const LANGUAGES: ReadonlyArray<[slug: string, label: string, code: string]> = [
  ["english", "English", "en"],
  ["jp", "Japanese", "ja"],
  ["chinese", "Chinese", "zh"],
  ["traditional-chinese", "Chinese (Traditional)", "zh-Hant"],
  ["korean", "Korean", "ko"],
  ["spanish", "Spanish", "es"],
  ["portuguese", "Portuguese", "pt"],
  ["french", "French", "fr"],
  ["thai", "Thai", "th"],
  ["vietnamese", "Vietnamese", "vi"],
  ["bahasa", "Bahasa Indonesia", "id"],
  ["russian", "Russian", "ru"],
  ["italian", "Italian", "it"],
  ["german", "German", "de"],
  ["filipino", "Filipino", "fil"],
  ["cantonese", "Cantonese", "yue"],
  ["bulgarian", "Bulgarian", "bg"],
  ["hungarian", "Hungarian", "hu"],
  ["swedish", "Swedish", "sv"],
  ["hindi", "Hindi", "hi"],
  ["arabic", "Arabic", "ar"],
  ["hebrew", "Hebrew", "he"],
  ["flemish-dutch", "Flemish Dutch", "nl"],
  ["polish", "Polish", "pl"],
  ["turkish", "Turkish", "tr"],
  ["greek", "Greek", "el"],
  ["danish", "Danish", "da"],
  ["finnish", "Finnish", "fi"],
  ["norwegian-bokmal", "Norwegian Bokmål", "nb"],
  ["malay", "Malay", "ms"],
];
const LANGUAGE_CODE = new Map(LANGUAGES.map(([slug, , code]) => [slug, code]));
const ALL = "all";
const DEFAULT_LANGUAGE = "english";

/** The search's facets (the site's most-used terms; the full lists run to thousands). */
const GENRES: ReadonlyArray<[string, string]> = [
  ["yaoi", "Yaoi"], ["romance", "Romance"], ["bara", "Bara/ Muscle"], ["drama", "Drama"], ["comedy", "Comedy"],
  ["shounen-ai", "Shounen Ai"], ["furry", "Furry"], ["slice-of-life", "Slice of Life"], ["supernatural", "Supernatural"],
  ["fantasy", "Fantasy"], ["omegaverse", "Omegaverse"], ["tragedy", "Tragedy"], ["historical", "Historical"], ["3d", "3D"],
  ["action", "Action"], ["hentai", "Het/ Hentai"], ["sports", "Sports"], ["psychological", "Psychological"],
  ["mystery", "Mystery"], ["horror", "Horror"], ["sci-fi", "Sci-Fi"], ["thriller", "Thriller"],
  ["dom-sub-verse", "Dom/Sub Verse"], ["family", "Family"], ["music", "Music"], ["crime", "Crime"],
  ["biography", "Biography"], ["wuxia", "Wuxia"], ["war", "War"],
];

const CATEGORIES: ReadonlyArray<[string, string]> = [
  ["oneshot", "One shot"], ["yaoi-manga", "Manga"], ["manhwa", "Manhwa"], ["cg", "CG/ Art"],
  ["boku-no-hero-academia-dj", "Boku no Hero Academia"], ["haikyuu-dj", "Haikyuu!!"], ["kuroko-no-basuke-dj", "Kuroko no Basuke"],
  ["jojo-dj", "JoJo's Bizarre Adventure"], ["attack-on-titan", "Attack on Titan"], ["hetalia", "Hetalia: Axis Powers"],
  ["jujutsu-kaisen-dj", "Jujutsu Kaisen"], ["one-piece-dj", "One Piece"], ["tiger-bunny-dj", "Tiger and Bunny"],
  ["free-dj", "Free!"], ["naru-dj", "Naruto"], ["gintama", "Gintama"], ["katekyo-hitman-reborn-dj", "Katekyo Hitman Reborn!"],
  ["yuri-on-ice-dj", "Yuri on Ice"], ["osomatsu-kun-dj", "Osomatsu-san"], ["daiya-no-a-dj", "Ace of Diamond"],
  ["durarara-dj", "Durarara"], ["pokemon-dj", "Pokémon"], ["dcu", "DCU"], ["fategrand-order-dj", "Fate/Grand Order"],
  ["ff-dj", "Final Fantasy"], ["genshin-impact-dj", "Genshin Impact"], ["detective-conan-dj", "Detective Conan"],
  ["touken-ranbu-dj", "Touken Ranbu"], ["yu-gi-oh-dj", "Yu-Gi-Oh!"], ["street-fighter-dj", "Street Fighter"],
];

const TAGS: ReadonlyArray<[string, string]> = [
  ["hardcore", "Hardcore"], ["uncensored", "Uncensored"], ["full-color", "Full color"], ["western", "Western"],
  ["big-penis", "Big penis"], ["blowjob", "Blowjob"], ["threesome-yaoi", "Threesome"], ["cross-dressing", "Cross-dressing"],
  ["group-sex", "Group"], ["hairy", "Hairy"], ["sex-toy", "Sex toy"], ["bondage", "Bondage"], ["masturbation", "Masturbation"],
  ["chubby", "Chubby/ Fat"], ["dark-skin", "Dark skin"], ["x-ray", "X-ray"], ["animal-characteristic", "Animal characteristic"],
  ["ahegao", "Ahegao"], ["double-penetration", "Double penetration"], ["butt-licking", "Rimjob"],
  ["reversible-couple", "Reversible"], ["big-breasts", "Big breasts"], ["nipple-play", "Nipple play"], ["tentacle", "Tentacle"],
  ["condom", "Condom"], ["mind-break", "Mind break"], ["office-worker", "Office worker"],
];

const STATUSES: ReadonlyArray<[string, string]> = [
  ["completed", "Completed"], ["ongoing", "Ongoing"], ["hiatus", "Hiatus"], ["dropped", "Dropped"],
  ["discontinued", "Discontinued"], ["licensed", "Licensed"],
];

/** `facet:slug` search tokens → the site's facet parameter. */
const FACETS: Readonly<Record<string, string>> = {
  lang: "ep_filter_lang",
  genre: "ep_filter_genre",
  category: "ep_filter_category",
  tag: "ep_filter_post_tag",
  status: "ep_filter_status",
  artist: "ep_filter_artist",
  pairing: "ep_filter_pairing",
  group: "ep_filter_group",
};

/** Search filter key → facet parameter. */
const FILTER_PARAMS: Readonly<Record<string, string>> = {
  genre: "ep_filter_genre",
  category: "ep_filter_category",
  tag: "ep_filter_post_tag",
  status: "ep_filter_status",
};

/** First path segments that are site sections, never a post. */
const RESERVED = new Set([
  "lang", "page", "tag", "tags", "genre", "artist", "pairing", "group", "status", "cats", "director", "author",
  "category", "feed", "comments", "search", "wp-content", "wp-admin", "wp-json", "wp-includes", "wp-login.php",
]);

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)/i;

const isSlug = (s: string) => /^[\w%-]+$/.test(s) && !RESERVED.has(s.toLowerCase());

/** `{ seriesId, part }` from a site URL, or undefined when it isn't a post link. */
export function parsePostLink(url: string): { seriesId: string; part?: number } | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (!/^(?:www\.)?myreadingmanga\.info$/i.test(u.hostname)) return undefined;
  const m = /^\/([^/]+)(?:\/(\d+))?\/?$/.exec(u.pathname);
  if (!m || !isSlug(m[1]!)) return undefined;
  const part = m[2] ? Number(m[2]) : undefined;
  return part && part > 1 ? { seriesId: m[1]!, part } : { seriesId: m[1]! };
}

/**
 * A post title without its credits and labels: `[Artist] Title [Eng] {Group} (update c.13)` →
 * `Title`. A trailing parenthetical is dropped only when it is an update note, so a pairing or a
 * subtitle in parentheses stays.
 */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/\(\s*(?:update\b|c\.|ch\.|chapter\b)[^)]*\)\s*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The leading `[Artist (Circle)]` of a post title, if any. */
function creditOf(raw: string): string | undefined {
  return /^\s*\[([^\]]+)\]/.exec(raw)?.[1]?.trim() || undefined;
}

/** A list thumbnail at full size (`cover-200x280.webp` → `cover.webp`). */
function fullSize(url: string): string {
  return url.replace(/-\d+x\d+(\.\w+)$/, "$1");
}

/** A path's last segment (`https://…/genre/bara/` → `bara`). */
function slugOf(href: string | undefined): string | undefined {
  return href?.replace(/[?#].*$/, "").split("/").filter(Boolean).pop() || undefined;
}

type Node = ReturnType<CheerioRoot>;

class MyReadingMangaBridge extends BridgeBase {
  readonly info: BridgeInfo = {
    id: "pos5drow.myreadingmanga",
    name: "MyReadingManga",
    version: "0.1.3",
    contractVersion: "2.1.0",
    languages: ["multi"],
    nsfw: true,
    capabilities: ["lists", "search", "filters", "sort", "settings"],
    cardSubtitles: true,
    iconUrl: bridgeIcon("myreadingmanga"),
    rateLimit: { maxConcurrent: 2, minIntervalMs: 500 },
    assetRateLimit: { maxConcurrent: 4, minIntervalMs: 100 },
    linkHosts: ["myreadingmanga.info"],
    // Covers and pages sit behind the site's Cloudflare check too, so they go through the host's
    // image route, which sends the session the web check earned.
    images: { hosts: ["myreadingmanga.info"], headers: { Referer: `${SITE}/` } },
  };

  private readonly guards = standardGuards(["myreadingmanga.info"]);

  private get ua(): string {
    const h = this.userAgent;
    return h && h.startsWith("Mozilla/5.0") ? h : FALLBACK_UA;
  }

  protected override async request(req: HttpRequest): Promise<HttpResponse> {
    return guardResponse(await super.request(req), this.guards, req);
  }

  getSettings(): SettingDescriptor[] {
    return [
      {
        type: "enum",
        key: "language",
        label: "Language",
        description: "Which translations the lists and searches show.",
        options: [{ value: ALL, label: "All languages" }, ...LANGUAGES.map(([value, label]) => ({ value, label }))],
        default: DEFAULT_LANGUAGE,
      },
    ];
  }

  /** The chosen language slug, or "all". */
  private get lang(): string {
    const v = this.settings["language"];
    return typeof v === "string" && (v === ALL || LANGUAGE_CODE.has(v)) ? v : DEFAULT_LANGUAGE;
  }

  private async page(url: string): Promise<CheerioRoot> {
    const res = await this.request({ url, headers: { "User-Agent": this.ua, Accept: "text/html,application/xhtml+xml", Referer: `${SITE}/` } });
    if (res.status === 404) throw new Error(seriesGoneMessage());
    if (res.status >= 400) throw new Error(`MyReadingManga answered HTTP ${res.status} for ${new URL(url).pathname}`);
    return this.parse(res.body);
  }

  // ── Lists & search ──────────────────────────────────────────────────────────

  private entry(el: Node): SeriesEntry | undefined {
    const a = el.find("a[rel=bookmark], .entry-title a").first();
    const parsed = parsePostLink(a.attr("href") ?? "");
    const raw = a.text().trim();
    if (!parsed || !raw) return undefined;
    const e: SeriesEntry = { id: parsed.seriesId, title: cleanTitle(raw) || raw };
    const img = el.find("a.entry-image-link img").first();
    const src = img.length ? imageOf(img, SITE) : undefined;
    if (src) e.thumbnailUrl = fullSize(src);
    const update = /\(\s*((?:update\b|c\.|ch\.)[^)]*)\)\s*$/i.exec(raw)?.[1];
    const sub = [creditOf(raw), update?.trim()].filter(Boolean).join(" · ");
    if (sub) e.subtitle = sub;
    return e;
  }

  /** Every readable card on a listing (video posts left out), and whether there's a next page. */
  private results($: CheerioRoot, page: number): PagedResults<SeriesEntry> {
    const items: SeriesEntry[] = [];
    const seen = new Set<string>();
    $("article.post").each((_, node) => {
      const el = $(node);
      if (el.hasClass("category-video")) return;
      const e = this.entry(el);
      if (e && !seen.has(e.id)) {
        seen.add(e.id);
        items.push(e);
      }
    });
    return { items, nextCursor: nextPageCursor(page, $("li.pagination-next a").length > 0) };
  }

  async getLists(): Promise<SeriesList[]> {
    return [
      { id: "latest", name: "Latest", layout: "grid", featured: true },
      { id: "random", name: "Random", layout: "grid" },
    ];
  }

  async getListItems(listId: string, req: ListRequest = {}): Promise<PagedResults<SeriesEntry>> {
    const page = pageFromCursor(req.cursor);
    if (listId === "random") return this.search(page, "", "rand", new URLSearchParams(), this.lang);
    if (listId !== "latest") throw new Error(`unknown list: ${listId}`);
    const base = this.lang === ALL ? `${SITE}/` : `${SITE}/lang/${this.lang}/`;
    return this.results(await this.page(page > 1 ? `${base}page/${page}/` : base), page);
  }

  async getFilters(): Promise<Filter[]> {
    const options = (list: ReadonlyArray<readonly [string, string]>) => list.map(([value, label]) => ({ value, label }));
    return [
      { type: "select", key: "language", label: "Language", options: [{ value: ALL, label: "All languages" }, ...LANGUAGES.map(([value, label]) => ({ value, label }))] },
      { type: "select", key: "genre", label: "Genre", options: options(GENRES) },
      { type: "select", key: "category", label: "Category", options: options(CATEGORIES) },
      { type: "select", key: "tag", label: "Tag", options: options(TAGS) },
      { type: "select", key: "status", label: "Status", options: options(STATUSES) },
    ];
  }

  async getSortOptions(): Promise<SortOption[]> {
    return [
      { key: "relevance", label: "Relevance", directionless: true },
      { key: "date", label: "Date" },
      { key: "rand", label: "Random", directionless: true },
    ];
  }

  async getSearchResults(req: SearchRequest): Promise<PagedResults<SeriesEntry>> {
    const page = pageFromCursor(req.cursor);
    const facets = new URLSearchParams();
    const add = (param: string, value: string) => {
      const prev = facets.get(param);
      facets.set(param, prev ? `${prev},${value}` : value);
    };
    // `facet:slug` tokens (what a post's tag chips search for) become facet filters.
    const text = req.text
      .replace(/(?:^|\s)(\w+):([\w%-]+)(?=\s|$)/g, (whole, facet: string, slug: string) => {
        const param = FACETS[facet.toLowerCase()];
        if (!param) return whole;
        add(param, slug.toLowerCase());
        return " ";
      })
      .replace(/\s+/g, " ")
      .trim();
    let lang = this.lang;
    for (const f of req.filters ?? []) {
      if (typeof f.value !== "string" || !f.value) continue;
      if (f.key === "language" && (f.value === ALL || LANGUAGE_CODE.has(f.value))) lang = f.value;
      const param = FILTER_PARAMS[f.key];
      if (param && /^[\w-]+$/.test(f.value)) add(param, f.value);
    }
    let sort = req.sort?.key ?? (text ? "relevance" : "date");
    if (sort === "date" && req.sort?.ascending) sort = "date_asc";
    if (!["relevance", "date", "date_asc", "rand"].includes(sort)) sort = "date";
    return this.search(page, text, sort, facets, lang);
  }

  private async search(page: number, text: string, sort: string, facets: URLSearchParams, lang: string): Promise<PagedResults<SeriesEntry>> {
    const q = new URLSearchParams({ s: text, ep_sort: sort });
    // A `lang:` token wins over the setting and the filter.
    const tokenLang = facets.get("ep_filter_lang");
    facets.delete("ep_filter_lang");
    if (tokenLang) q.set("ep_filter_lang", tokenLang);
    else if (lang !== ALL) q.set("ep_filter_lang", lang);
    for (const [k, v] of facets) q.set(k, v);
    return this.results(await this.page(`${SITE}/page/${page}/?${q}`), page);
  }

  // ── Details, chapters, pages ────────────────────────────────────────────────

  private postUrl(seriesId: string, part = 1): string {
    return part > 1 ? `${SITE}/${seriesId}/${part}/` : `${SITE}/${seriesId}/`;
  }

  /** A post's page (part `part`), checked to be a post. */
  private async post(seriesId: string, part = 1): Promise<CheerioRoot> {
    if (!isSlug(seriesId)) throw new Error(seriesGoneMessage());
    const $ = await this.page(this.postUrl(seriesId, part));
    if (!$("body").hasClass("single-post") && $("article.post h1.entry-title").length === 0) {
      throw new Error("MyReadingManga: this address is a listing or category page, not a post");
    }
    return $;
  }

  async getSeriesDetails(seriesId: string): Promise<SeriesInfo> {
    const $ = await this.post(seriesId);
    const article = $("article.post").first();
    const raw = article.find("h1.entry-title").first().text().trim();
    if (!raw) throw new Error("MyReadingManga changed its post pages (no title found); this bridge needs an update");
    const info: SeriesInfo = { id: seriesId, title: cleanTitle(raw) || raw, shareUrl: this.postUrl(seriesId) };
    if (info.title !== raw) info.altTitles = [raw];

    const header = article.find(".entry-header").first();
    const linked = (path: string) => {
      const names: string[] = [];
      const slugs: string[] = [];
      header.find(`a[href*="/${path}/"]`).each((_, a) => {
        const name = $(a).text().trim();
        const slug = slugOf($(a).attr("href"));
        if (name && slug && !slugs.includes(slug)) {
          names.push(name);
          slugs.push(slug);
        }
      });
      return { names, slugs };
    };

    const creators = linked("artist");
    const credit = creditOf(raw);
    const authors = creators.names.length ? creators.names : credit ? [credit] : [];
    if (authors.length) {
      info.authors = authors.map((name) => ({ name }));
      info.author = authors.join(", ");
    }

    const cover = thumbnailOf($) ?? pageImages($, this.postUrl(seriesId))[0];
    if (cover) info.thumbnailUrl = cover;

    const groups: TagGroup[] = [];
    const group = (label: string, kind: TagGroup["kind"] | undefined, facet: string, list: { names: string[]; slugs: string[] }) => {
      if (!list.names.length) return;
      const g: TagGroup = { label, tags: list.names, tagQueries: list.slugs.map((s) => `${facet}:${s}`) };
      if (kind) g.kind = kind;
      groups.push(g);
    };
    group("Genres", "genre", "genre", linked("genre"));
    const categories = { names: [] as string[], slugs: [] as string[] };
    header.find(".entry-categories a").each((_, a) => {
      const name = $(a).text().trim();
      const slug = slugOf($(a).attr("href"));
      if (name && slug) {
        categories.names.push(name);
        categories.slugs.push(slug);
      }
    });
    group("Category", "format", "category", categories);
    group("Tags", "theme", "tag", linked("tag"));
    group("Pairing", undefined, "pairing", linked("pairing"));
    const scanlators = linked("group");
    group("Scanlators", undefined, "group", scanlators);
    group("Creator", undefined, "artist", creators);
    const langs = linked("lang");
    group("Language", undefined, "lang", langs);
    if (groups.length) info.tagGroups = groups;

    const codes = langs.slugs.map((s) => LANGUAGE_CODE.get(s)).filter((c): c is string => !!c);
    if (codes.length) info.languages = codes;

    const statusSlug = linked("status").slugs[0] ?? /\bstatus-([\w-]+)/.exec(article.attr("class") ?? "")?.[1];
    const status = parseStatus(statusSlug);
    if (status !== "unknown") info.status = status;

    const direction = $("p.top-info").first().text();
    if (/left\s+to\s+right/i.test(direction)) info.readingDirection = "ltr";
    else if (/right\s+to\s+left/i.test(direction)) info.readingDirection = "rtl";

    const lines: string[] = [];
    article.find(".entry-content p").each((_, p) => {
      const el = $(p);
      if (el.closest(".entry-pagination").length || el.hasClass("chapter-class") || el.prev().hasClass("chapter-class")) return;
      const t = el.text().replace(/\s+/g, " ").trim();
      if (t && !t.includes("|")) lines.push(t);
    });
    if (scanlators.names.length) lines.push(`Scanlated by: ${scanlators.names.join(", ")}`);
    if (lines.length) info.description = lines.join("\n");
    return info;
  }

  override async getChapters(seriesId: string): Promise<Chapter[]> {
    const $ = await this.post(seriesId);
    return chaptersOf($);
  }

  override async getChapterPages(seriesId: string, chapterId: string): Promise<Page[]> {
    if (!/^[1-9]\d*$/.test(chapterId)) throw new Error(seriesGoneMessage("chapter removed from the source"));
    const part = Number(chapterId);
    const $ = await this.post(seriesId, part);
    const images = pageImages($, this.postUrl(seriesId, part));
    if (images.length === 0) throw new Error("MyReadingManga: this part has no images to show (it may be a video post)");
    return images.map((imageUrl, index) => ({ index, imageUrl }));
  }

  // ── Links ───────────────────────────────────────────────────────────────────

  /** A post link, or a link to one of its parts (`/{slug}/{n}/`). Section pages (`/lang/…`, `/tag/…`) aren't posts. */
  async resolveUrl(url: string): Promise<LinkTarget | null> {
    const link = parsePostLink(url);
    if (!link) return null;
    return link.part ? { seriesId: link.seriesId, chapterId: String(link.part) } : { seriesId: link.seriesId };
  }
}

/** An `<img>`'s real source, as the site's lazy loaders leave it. */
function imageOf(img: { attr(name: string): string | undefined }, base: string): string | undefined {
  const pick = ["data-src", "data-cfsrc", "src"].map((k) => img.attr(k)?.trim()).find((v) => v && IMAGE_EXTENSION.test(v))
    ?? img.attr("data-lazy-src")?.trim();
  if (!pick) return undefined;
  const abs = absoluteUrl(pick, base);
  return abs && /^https?:\/\//i.test(abs) ? abs : undefined;
}

/** The post's own cover (its JSON-LD `thumbnailUrl`), if the page carries one. */
function thumbnailOf($: CheerioRoot): string | undefined {
  let found: string | undefined;
  $('script[type="application/ld+json"]').each((_, s) => {
    if (found) return;
    const m = /"thumbnailUrl"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec($(s).html() ?? "");
    if (m) {
      try {
        const url = JSON.parse(`"${m[1]}"`) as string;
        if (/^https?:\/\//.test(url)) found = url;
      } catch {
        // Not a string we can read; no cover from here.
      }
    }
  });
  return found;
}

/** The part's page images, in order and once each; banners (images linking off the site) left out. */
function pageImages($: CheerioRoot, base: string): string[] {
  const out: string[] = [];
  const nodes = [...$("div.entry-content img").toArray(), ...$("div.separator img[data-src]").toArray()];
  for (const node of nodes) {
    const img = $(node);
    const link = img.closest("a[href]").attr("href");
    if (link) {
      try {
        if (!/(^|\.)myreadingmanga\.info$/i.test(hostOf(absoluteUrl(link, base) ?? "") ?? "")) continue;
      } catch {
        continue;
      }
    }
    const src = imageOf(img, base);
    if (src && !out.includes(src)) out.push(src);
  }
  return out;
}

/** Part 1 is the post itself; its pagination names the last part (`1 2 3 4 … 12 13 14 »`). Newest first. */
function chaptersOf($: CheerioRoot): Chapter[] {
  const article = $("article.post").first();
  let last = 1;
  article.find(".entry-pagination a.page-numbers, .entry-content .pagination a.page-numbers").each((_, a) => {
    const el = $(a);
    if (el.hasClass("next") || el.hasClass("prev")) return;
    const n = Number(el.text().trim());
    if (Number.isInteger(n) && n > last) last = n;
  });
  const date = publishedOf($);
  const langClass = /\blang-([\w-]+)/.exec(article.attr("class") ?? "")?.[1];
  const language = langClass ? LANGUAGE_CODE.get(langClass) : undefined;
  const scanlators = article.find('.entry-header a[href*="/group/"]').map((_, a) => $(a).text().trim()).get().filter(Boolean);
  const chapters: Chapter[] = [];
  for (let n = last; n >= 1; n--) {
    const ch: Chapter = { id: String(n), name: `Part ${n}`, number: n };
    if (date !== undefined) ch.publishedAt = date;
    if (language) ch.languageCode = language;
    if (scanlators.length) ch.group = scanlators.join(", ");
    chapters.push(ch);
  }
  return chapters;
}

/** When the post went up: its JSON-LD `datePublished`, else the header's `November 16, 2026`. */
function publishedOf($: CheerioRoot): number | undefined {
  let iso: string | undefined;
  $('script[type="application/ld+json"]').each((_, s) => {
    iso ??= /"datePublished"\s*:\s*"([^"]+)"/.exec($(s).html() ?? "")?.[1];
  });
  const t = iso ? Date.parse(iso) : Date.parse(`${$(".entry-time").first().text().trim()} UTC`);
  return Number.isFinite(t) ? t : undefined;
}

export default defineBridge((host) => new MyReadingMangaBridge(host));
