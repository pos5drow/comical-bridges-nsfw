# Source roadmap (NSFW)

NSFW bridges we plan to add to this repo. The survey method, the status legend, the blocker codes,
the shared-engine design and the maintenance plan are all written up in the SFW repo
(`comical-bridges/docs/roadmap.md`, `shared-engines.md`, `maintenance.md`). This file only tracks
this repo's targets.

**Update this file in the same commit that changes a bridge's status.** Open follow-ups for both
repos (web check, phone checks, decisions) are listed in the SFW roadmap, "Open follow-ups".

Already shipped: E-Hentai, Hitomi, nhentai. Added here: HentaiFox, IMHentai (galleryadults engine), Hentai2Read, wnacg, JMComic, Kemono and Pawchive (kemono engine).

## Targets

| Source | Site | Engine | Upstream refs | Signals | Blockers | Status |
|---|---|---|---|---|---|---|
| HDoujin | hdoujin.org | bespoke | kei `all/hdoujin` | 17 👍 request | Browsing and details are open; pages need the site's `crt` clearance token, which its home page's Turnstile leaves in localStorage `clearance` | **built** (pages via the page-storage web check; untested on a device) |
| Kemono | kemono.cr | **kemono** | kei `all/kemono` | EverythingMoe; kei ships both | creator list is one ~12 MB JSON (no server-side creator search): fetched once, kept 30 min, compacted. Full-size file servers often unreachable: thumbnails by default | **shipped 0.1.0** (live audit passes) |
| Coomer | coomer.st | **kemono** | kei `all/coomer` | same engine as Kemono | real people's paywalled explicit content (OnlyFans, Fansly) redistributed without their consent | **dropped** (see below) |
| Pawchive | pawchive.pw | **kemono** (same API) | kei `all/pawchive` | 14 👍 request | its file servers ask scripts for an honest User-Agent and ≤1 req/s, ≤5 downloads, and block browser impersonation: the bridge identifies itself and keeps to that, and gets full-size files | **shipped 0.1.0** (live audit passes) |
| MyReadingManga | myreadingmanga.info | bespoke (WordPress) | kei `all/myreadingmanga`, aidoku `multi.myreadingmanga` | #48 in the comics category | **CF-CLEARANCE**: "Verification Required" challenge on every page, even for curl (2026-11-15) | blocked |
| Hentai2Read | hentai2read.com | bespoke (Inertia app: page data embedded as JSON) | aidoku `en.hentai2read` (not in Keiyoushi) | in Aidoku | **TLS-FINGERPRINT**: built from pages fetched by hand, audit flaky | **shipped 0.1.0** |
| Schale Network | niyaniya.moe | bespoke | kei `all/schalenetwork` | in Keiyoushi | Same engine and token as HDoujin (Keiyoushi mints the token by solving the Turnstile itself; here the person or Cloudflare's own non-interactive check passes it in the web check) | **built** (as HDoujin) |
| IMHentai | imhentai.xxx | **galleryadults** | kei `all/imhentai` | in Keiyoushi | **TLS-FINGERPRINT** (Cloudflare challenges Node/Bun; curl passes): built from pages fetched by hand, audit flaky | **shipped 0.1.0** |
| HentaiFox | hentaifox.com | **galleryadults** | kei `all/hentaifox` | in Keiyoushi | — | **shipped 0.1.0** (live audit passes) |
| wnacg | wnacg.buzz / .site (mirrors in settings) | bespoke (zh) | kei `zh/wnacg`, aidoku `zh.wnacg` | in both | — (some categories need sign-in; photo/cosplay category left out on purpose) | **shipped 0.1.0** (live audit passes) |
| JMComic (18comic) | 18comic.ink (+ .vip, jmcomic-zzz mirrors in settings) | bespoke (zh), the website | kei `zh/jinmantiantang`, aidoku `zh.jmcomic` | in both | strip shuffle: done with processed page images (`stripLayout`), verified on real pages. Uses the public website, not the mobile app's encrypted API (that would mean posing as the official app with its embedded secret) | **shipped 0.1.0** (live audit passes) |

**Nearly free now the galleryadults engine exists** (Keiyoushi runs 11 sites on it): HentaiRox,
HentaiZap, HentaiEnvy, AsmHentai, HentaiEra and others. All five answer Node/Bun (checked
2026-11-15), but only HentaiEra's home page uses the same `div.thumb` cards; the others need their
own card selectors in the site config. Not on the list; candidates once the list is done.

## Blocked or partly blocked

Known risks from the survey: wnacg may need
**JS-SOLVER** or **CF-CLEARANCE** (see `comical-bridges/docs/roadmap.md`, "Blocked or partly
blocked", for what those would take). JMComic's strip shuffle is covered by processed page images.
Its encrypted API still needs investigating.

E-Hentai, Hitomi and nhentai got patch bumps with the first push here (the comical contract change
had changed every bundle), and `build.ts` now drops Bun's `debugId` line, as in the SFW repo, so a
bundle's bytes change only when its code does.

- **HDoujin and Schale Network** (built 2026-11-15, `engines/schale.ts`): one front end and one
  API. Browsing, search and details need no token. Pages call `POST /books/detail/{id}/{key}?crt`
  for the image sets and `GET /books/data/…?crt` for the pages. With no token, or on the API's
  empty 403 for a bad one, the bridge raises a web check of the home page with
  `storage: ["clearance"]`, and reads the value back from `webCheckStorageKey("clearance")`.
  Verified against the live open endpoints and, end to end, through core with a mock; the token
  flow itself still needs a device. The image CDN wants the site's `Origin`, declared in `images`.
- **IMHentai:** Cloudflare challenges the Node/Bun TLS fingerprint (curl and phone stacks pass), so
  it was built from pages fetched by hand; its engine is live-verified through HentaiFox. Needs the
  SFW repo's **TLS-FINGERPRINT** answer (check on a phone first).

## Skipped, and why

| Source | Why | What would change that |
|---|---|---|
| Coomer | It republishes real people's paywalled explicit photos and videos (OnlyFans, Fansly, CandFans) without their consent. Unlike the drawn-art and doujinshi sites here, building a client for it means helping spread intimate imagery of real, identifiable people against their will. Not built. | Nothing on the technical side; this is a content decision. |
| MyReadingManga | Cloudflare's "Verification Required" challenge on every page, even for curl. | CF-CLEARANCE (the user passes the check in an in-app web view). |
| wnacg photo/cosplay category | Real people, not drawn work; left out of the category filter for the same reason as Coomer. The rest of the site is built. | A content decision, not a technical one. |

## Notes from building

- **JMComic (2026-11-15):** Keiyoushi uses the mobile app's API, which needs a token made from a
  secret embedded in the official app and AES-decrypts the responses with a key derived from it.
  This bridge reads the public website instead: lists, search, album pages and the reader all
  answer Node/Bun on 18comic.ink (18comic.vip and the jmcomic-zzz mirrors are Cloudflare-challenged
  from here, so they're offered but not the default). Pages of albums from 220980 on are stored as
  horizontal strips bottom-up; the strip count is the last hex digit of md5(aid + file name), mod 8
  or 10 by album age, times two plus two. The layout is the SDK's `stripLayout` reversed. Checked on
  three real pages without viewing them: after the layout, the rows either side of each seam differ
  as little as any neighbouring rows (e.g. 3.1 vs 2.3 typical), against 20-30x that before.
- **Kemono and Pawchive (2026-11-15):** probed with the user's go-ahead. One API, so one engine
  (`engines/kemono.ts`). Neither has a creator search, and the sites' own artist pages download the
  whole creator list, so the bridge does too, once per 30 minutes, kept compacted (~100k creators;
  ~40 MB of heap while parsing in Bun). Kemono's full-size servers (`n1`–`n4`) timed out from here,
  so pages default to its 800 px thumbnails. Pawchive's file servers refuse browser User-Agents
  and say why: they want scripts to identify themselves and stay under 1 req/s and 5 downloads. With
  an honest User-Agent they serve full-size files, so that's what the bridge does (its User-Agent
  has no contact address; one could be added). Keiyoushi's Pawchive sends a browser User-Agent.

- **Fixtures for every bridge here are cut to one gallery chosen for tame tags** (no minors,
  school, incest or non-consent tags); related-gallery strips and sidebars are removed.

## Suggested build order

1. galleryadults engine → IMHentai, HentaiFox.
2. kemono engine → Kemono, Pawchive (done; Coomer dropped).
3. MyReadingManga, Hentai2Read.
4. After the JS-SOLVER investigations: wnacg (HDoujin and Schale Network are built).
5. After IMG-TILES lands: JMComic.
