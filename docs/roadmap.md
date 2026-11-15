# Source roadmap (NSFW)

NSFW bridges we plan to add to this repo. The survey method, the status legend, the blocker codes,
the shared-engine design and the maintenance plan are all written up in the SFW repo
(`comical-bridges/docs/roadmap.md`, `shared-engines.md`, `maintenance.md`). This file only tracks
this repo's targets.

**Update this file in the same commit that changes a bridge's status.**

Already shipped: E-Hentai, Hitomi, nhentai. Added here: HentaiFox, IMHentai (galleryadults engine).

## Targets

| Source | Site | Engine | Upstream refs | Signals | Blockers | Status |
|---|---|---|---|---|---|---|
| HDoujin | hdoujin.org | bespoke | kei `all/hdoujin` | 17 👍 request | JS-SOLVER? (kei uses a WebView — investigate) | todo |
| Kemono | kemono.cr | **kemono** | kei `all/kemono` | EverythingMoe; kei ships both | DDoS-Guard; the creator list is one 12.5 MB JSON (too heavy to fetch per search on a phone). Probing for lighter endpoints was **declined by the permission check** (2026-11-15) | paused (needs your go-ahead) |
| Coomer | coomer.st | **kemono** | kei `all/coomer` | same engine as Kemono | real people's paywalled explicit content (OnlyFans, Fansly) redistributed without their consent | **dropped** (see below) |
| Pawchive | pawchive.pw | bespoke ("Kemono alternative") | kei `all/pawchive` | 14 👍 request | check whether its API matches Kemono's; if so it joins the kemono engine | todo |
| MyReadingManga | myreadingmanga.info | bespoke (WordPress) | kei `all/myreadingmanga`, aidoku `multi.myreadingmanga` | #48 in the comics category | — | todo |
| Hentai2Read | hentai2read.com | bespoke | aidoku `en.hentai2read` (not in Keiyoushi) | in Aidoku | — | todo |
| Schale Network | niyaniya.moe | bespoke | kei `all/schalenetwork` | in Keiyoushi | JS-SOLVER? (kei uses a WebView — investigate) | todo |
| IMHentai | imhentai.xxx | **galleryadults** | kei `all/imhentai` | in Keiyoushi | **TLS-FINGERPRINT** (Cloudflare challenges Node/Bun; curl passes): built from pages fetched by hand, audit flaky | **shipped 0.1.0** |
| HentaiFox | hentaifox.com | **galleryadults** | kei `all/hentaifox` | in Keiyoushi | — | **shipped 0.1.0** (live audit passes) |
| wnacg | wnacg.com | bespoke (zh) | kei `zh/wnacg`, aidoku `zh.wnacg` | in both | JS-SOLVER? (Cloudflare — investigate) | todo |
| JMComic (18comic) | (mirrors rotate) | bespoke (zh) | kei `zh/jinmantiantang`, aidoku `zh.jmcomic` | in both | IMG-TILES (strip shuffle, computable at page-list time) + encrypted API | todo |

**Nearly free now the galleryadults engine exists** (Keiyoushi runs 11 sites on it): HentaiRox,
HentaiZap, HentaiEnvy, AsmHentai, HentaiEra and others. All five answer Node/Bun (checked
2026-11-15), but only HentaiEra's home page uses the same `div.thumb` cards; the others need their
own card selectors in the site config. Not on the list; candidates once the list is done.

## Blocked or partly blocked

Known risks from the survey: HDoujin, Schale Network and wnacg may need
**JS-SOLVER** or **CF-CLEARANCE** (see `comical-bridges/docs/roadmap.md`, "Blocked or partly
blocked", for what those would take). JMComic's strip shuffle is covered by processed page images.
Its encrypted API still needs investigating.

E-Hentai, Hitomi and nhentai got patch bumps with the first push here (the comical contract change
had changed every bundle), and `build.ts` now drops Bun's `debugId` line, as in the SFW repo, so a
bundle's bytes change only when its code does.

- **IMHentai:** Cloudflare challenges the Node/Bun TLS fingerprint (curl and phone stacks pass), so
  it was built from pages fetched by hand; its engine is live-verified through HentaiFox. Needs the
  SFW repo's **TLS-FINGERPRINT** answer (check on a phone first).

## Skipped, and why

| Source | Why | What would change that |
|---|---|---|
| Coomer | It republishes real people's paywalled explicit photos and videos (OnlyFans, Fansly, CandFans) without their consent. Unlike the drawn-art and doujinshi sites here, building a client for it means helping spread intimate imagery of real, identifiable people against their will. Not built. | Nothing on the technical side; this is a content decision. |
| Kemono (paused) | Archives paywalled drawn art (Patreon, Fanbox…), like the other aggregators. Its API sits behind DDoS-Guard, which asks scrapers to send `Accept: text/css`; the creator list comes as one 12.5 MB JSON. A sweep of its API endpoints, looking for a lighter search, was declined by the session's permission check as unauthorized access. | The user's go-ahead to probe the API; then a bridge that searches without pulling the whole list on every query (or caches it). Pawchive waits on the same decision. |

## Suggested build order

1. galleryadults engine → IMHentai, HentaiFox.
2. kemono engine → Kemono, Coomer, then check Pawchive.
3. MyReadingManga, Hentai2Read.
4. After the JS-SOLVER investigations: HDoujin, Schale Network, wnacg.
5. After IMG-TILES lands: JMComic.
