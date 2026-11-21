# Bridge audit — detailed results

Per-check results from the live bridge audit — every conformance probe run against the real
backend. ✓ pass · ⚠ warn · ✗ fail · ⊘ skipped (auth-gated with no credentials, or an inconclusive
sort/filter probe — never a defect). Warnings never fail the run; a tolerated flaky/blocked bridge
shows ⚠ even for a hard failure.

## `nhentai` — ⚠ (13✓ 2⚠ 0✗ 2⊘)

**7/10 capabilities** · cover 29 KB (500×620) · sampled 8 · failed 0 · bytes min 19 KB / avg 29 KB / median 26 KB / max 52 KB · dims avg 500×620 (max 500×710) · aspect avg 0.88

> Cloudflare / IP-gated from datacenters

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `read.details.description` | core | series details have no description |
| ⚠ | `read.details.genres` | core | series details have no genre tag group (kind: "genre") |
| ⊘ | `sort.effect` | sort | asc/desc on "date" produced identical order |
| ⊘ | `favorites.read` | favorites | getFavorites needs credentials (none configured) — skipped: getFavorites threw: Error: favorites require an API key (create one at nhentai.net › Account › API Keys) |
| ✓ | `info.capabilities` | core | declares 10 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 2 list(s) |
| ✓ | `lists.items` | lists | list "popular-now" returned 5 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | single page (no nextCursor) |
| ✓ | `search.items` | search | search returned 25 item(s) |
| ✓ | `search.cursor` | search | nextCursor advanced to 25 further item(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 4 filter(s) |
| ✓ | `filters.effect` | filters | filter "language" changed results (25→25) |
| ✓ | `sort.options` | sort | getSortOptions returned 5 option(s) |
| ✓ | `settings.descriptors` | settings | getSettings returned 1 descriptor(s) |
| ✓ | `direct.pages` | direct | getSeriesPages returned 40 page(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

## `e-hentai` — ⚠ (12✓ 3⚠ 0✗ 1⊘)

**6/6 capabilities** · cover 20 KB (241×354) · sampled 8 · failed 0 · bytes min 15 KB / avg 20 KB / median 20 KB / max 22 KB · dims avg 241×354 (max 250×375) · aspect avg 0.69

> sad-panda / IP + cookie gated from datacenters

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `read.details.author` | core | series details have no author |
| ⚠ | `read.details.description` | core | series details have no description |
| ⚠ | `read.details.genres` | core | series details have no genre tag group (kind: "genre") |
| ⊘ | `favorites.read` | favorites | getFavorites needs credentials (none configured) — skipped: getFavorites threw: Error: [login-required:cookies] Sign in to e-hentai to see your favorites. |
| ✓ | `info.capabilities` | core | declares 6 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 2 list(s) |
| ✓ | `lists.items` | lists | list "popular" returned 53 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | single page (no nextCursor) |
| ✓ | `search.items` | search | search returned 25 item(s) |
| ✓ | `search.cursor` | search | nextCursor advanced to 25 further item(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 3 filter(s) |
| ✓ | `filters.effect` | filters | filter "category" changed results (25→25) |
| ✓ | `settings.descriptors` | settings | getSettings returned 3 descriptor(s) |
| ✓ | `direct.pages` | direct | getSeriesPages returned 1207 page(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

## `hitomi` — ✓ (13✓ 0⚠ 0✗)

**5/8 capabilities** · cover 41 KB (514×573) · sampled 8 · failed 0 · bytes min 30 KB / avg 41 KB / median 39 KB / max 58 KB · dims avg 514×573 (max 640×640) · aspect avg 0.94

> images need the host /img-proxy (Referer-gated), unavailable in the audit

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ✓ | `info.capabilities` | core | declares 8 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 12 list(s) |
| ✓ | `lists.items` | lists | list "home-popular-today" returned 12 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | nextCursor advanced to 12 further item(s) |
| ✓ | `search.items` | search | search returned 24 item(s) |
| ✓ | `search.cursor` | search | nextCursor advanced to 24 further item(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 7 filter(s) |
| ✓ | `filters.effect` | filters | filter "type" changed results (24→24) |
| ✓ | `sort.options` | sort | getSortOptions returned 7 option(s) |
| ✓ | `sort.effect` | sort | sort "latest" reorders results (asc ≠ desc) |
| ✓ | `direct.pages` | direct | getSeriesPages returned 59 page(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

## `hentaifox` — ✓ (11✓ 0⚠ 0✗ 1⊘)

**5/5 capabilities** · cover 53 KB (250×350) · sampled 8 · failed 0 · bytes min 24 KB / avg 53 KB / median 53 KB / max 81 KB · dims avg 250×350 (max 250×357) · aspect avg 0.71

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⊘ | `sort.effect` | sort | asc/desc on "latest" produced identical order |
| ✓ | `info.capabilities` | core | declares 5 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 2 list(s) |
| ✓ | `lists.items` | lists | list "popular" returned 20 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | nextCursor advanced to 20 further item(s) |
| ✓ | `search.items` | search | search returned 20 item(s) |
| ✓ | `search.cursor` | search | nextCursor advanced to 20 further item(s) |
| ✓ | `sort.options` | sort | getSortOptions returned 2 option(s) |
| ✓ | `settings.descriptors` | settings | getSettings returned 1 descriptor(s) |
| ✓ | `direct.pages` | direct | getSeriesPages returned 137 page(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

## `imhentai` — ⚠ (4✓ 5⚠ 0✗)

**5/5 capabilities** · cover —

> Cloudflare challenges the Bun/Node TLS fingerprint

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `lists.threw` | lists | lists browse threw: getListItems threw: [challenge:https%3A%2F%2Fimhentai.xxx%2Flanguage%2Fenglish%2Fpopular%2F\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `search.threw` | search | getSearchResults threw: getSearchResults threw: [challenge:https%3A%2F%2Fimhentai.xxx%2Flanguage%2Fenglish%2Fpopular%2F\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `sort.effect` | sort | applying a sort threw: getSearchResults threw: [challenge:https%3A%2F%2Fimhentai.xxx%2Flanguage%2Fenglish%2Fpopular%2F\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `direct.noSample` | direct | no series id available to probe getSeriesPages |
| ⚠ | `read.noSample` | core | no item available to sample the read path (search/lists returned nothing) |
| ✓ | `info.capabilities` | core | declares 5 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 2 list(s) |
| ✓ | `sort.options` | sort | getSortOptions returned 2 option(s) |
| ✓ | `settings.descriptors` | settings | getSettings returned 1 descriptor(s) |

## `hentai2read` — ⚠ (4✓ 5⚠ 0✗)

**4/4 capabilities** · cover —

> Cloudflare challenges the Bun/Node TLS fingerprint

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `lists.threw` | lists | lists browse threw: getListItems threw: [challenge:https%3A%2F%2Fhentai2read.com%2Fsearch%3Fq%3D%26sort%3Dlatest\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `search.threw` | search | getSearchResults threw: getSearchResults threw: [challenge:https%3A%2F%2Fhentai2read.com%2Fsearch%3Fq%3D%26sort%3Dlatest\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `filters.effect` | filters | applying a filter threw: getSearchResults threw: [challenge:https%3A%2F%2Fhentai2read.com%2Fsearch%3Fq%3D%26sort%3Dlatest\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `sort.effect` | sort | applying a sort threw: getSearchResults threw: [challenge:https%3A%2F%2Fhentai2read.com%2Fsearch%3Fq%3D%26sort%3Dlatest\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `read.noSample` | core | no item available to sample the read path (search/lists returned nothing) |
| ✓ | `info.capabilities` | core | declares 4 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 4 list(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 2 filter(s) |
| ✓ | `sort.options` | sort | getSortOptions returned 7 option(s) |

## `wnacg` — ⚠ (13✓ 2⚠ 0✗ 2⊘)

**5/5 capabilities** · cover 37 KB (300×400) · sampled 8 · failed 0 · bytes min 16 KB / avg 37 KB / median 31 KB / max 83 KB · dims avg 300×400 (max 300×400) · aspect avg 0.75

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `read.details.author` | core | series details have no author |
| ⚠ | `read.details.description` | core | series details have no description |
| ⊘ | `filters.effect` | filters | applying filter "category=5" did not change the sampled page |
| ⊘ | `sort.effect` | sort | asc/desc on "create_time_DESC" produced identical order |
| ✓ | `info.capabilities` | core | declares 5 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 3 list(s) |
| ✓ | `lists.items` | lists | list "ranking-week" returned 20 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | nextCursor advanced to 19 further item(s) |
| ✓ | `search.items` | search | search returned 24 item(s) |
| ✓ | `search.cursor` | search | nextCursor advanced to 24 further item(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 2 filter(s) |
| ✓ | `sort.options` | sort | getSortOptions returned 5 option(s) |
| ✓ | `settings.descriptors` | settings | getSettings returned 1 descriptor(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |
| ✓ | `read.chapters` | core | got 1 ordered, uniquely-identified chapter(s) |
| ✓ | `read.pages` | core | got 64 page(s) |

## `jmcomic` — ⚠ (4✓ 4⚠ 0✗)

**4/4 capabilities** · cover —

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `lists.threw` | lists | lists browse threw: getListItems threw: [challenge:https%3A%2F%2F18comic.ink%2Falbums%3Fo%3Dmr\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `search.threw` | search | getSearchResults threw: getSearchResults threw: [challenge:https%3A%2F%2F18comic.ink%2Falbums%3Fo%3Dmr\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `sort.effect` | sort | applying a sort threw: getSearchResults threw: [challenge:https%3A%2F%2F18comic.ink%2Falbums%3Fo%3Dmr\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `read.noSample` | core | no item available to sample the read path (search/lists returned nothing) |
| ✓ | `info.capabilities` | core | declares 4 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 3 list(s) |
| ✓ | `sort.options` | sort | getSortOptions returned 4 option(s) |
| ✓ | `settings.descriptors` | settings | getSettings returned 1 descriptor(s) |

## `kemono` — ⚠ (15✓ 1⚠ 0✗)

**5/5 capabilities** · cover — · sampled 0 · failed 8 · bytes min 0 KB / avg 0 KB / median 0 KB / max 0 KB

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `read.details.genres` | core | series details have no genre tag group (kind: "genre") |
| ✓ | `info.capabilities` | core | declares 5 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 2 list(s) |
| ✓ | `lists.items` | lists | list "popular" returned 50 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | nextCursor advanced to 50 further item(s) |
| ✓ | `search.items` | search | search returned 20 item(s) |
| ✓ | `search.cursor` | search | single page (no nextCursor) |
| ✓ | `filters.descriptors` | filters | getFilters returned 1 filter(s) |
| ✓ | `filters.effect` | filters | filter "service" changed results (20→17) |
| ✓ | `sort.options` | sort | getSortOptions returned 3 option(s) |
| ✓ | `sort.effect` | sort | sort "popular" reorders results (asc ≠ desc) |
| ✓ | `settings.descriptors` | settings | getSettings returned 2 descriptor(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |
| ✓ | `read.chapters` | core | got 96 ordered, uniquely-identified chapter(s) |
| ✓ | `read.pages` | core | got 11 page(s) |

## `pawchive` — ⚠ (15✓ 2⚠ 0✗)

**5/5 capabilities** · cover 8 KB (229×222) · sampled 8 · failed 0 · bytes min 5 KB / avg 8 KB / median 8 KB / max 12 KB · dims avg 229×222 (max 256×256) · aspect avg 1.04

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `read.details.description` | core | series details have no description |
| ⚠ | `read.details.genres` | core | series details have no genre tag group (kind: "genre") |
| ✓ | `info.capabilities` | core | declares 5 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 2 list(s) |
| ✓ | `lists.items` | lists | list "popular" returned 50 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | nextCursor advanced to 50 further item(s) |
| ✓ | `search.items` | search | search returned 21 item(s) |
| ✓ | `search.cursor` | search | single page (no nextCursor) |
| ✓ | `filters.descriptors` | filters | getFilters returned 1 filter(s) |
| ✓ | `filters.effect` | filters | filter "service" changed results (21→18) |
| ✓ | `sort.options` | sort | getSortOptions returned 3 option(s) |
| ✓ | `sort.effect` | sort | sort "popular" reorders results (asc ≠ desc) |
| ✓ | `settings.descriptors` | settings | getSettings returned 2 descriptor(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |
| ✓ | `read.chapters` | core | got 87 ordered, uniquely-identified chapter(s) |
| ✓ | `read.pages` | core | got 1 page(s) |

## `hdoujin` — ⚠ (12✓ 1⚠ 0✗ 1⊘)

**6/6 capabilities** · cover 26 KB (277×356) · sampled 8 · failed 0 · bytes min 12 KB / avg 26 KB / median 22 KB / max 59 KB · dims avg 277×356 (max 467×364) · aspect avg 0.78

> pages need a clearance token from a web check

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `direct.pages.threw` | direct | getSeriesPages threw: getSeriesPages threw: Error: [challenge:https%3A%2F%2Fhdoujin.org%2F\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36\|clearance] HDoujin wants to check this is a person before showing pages |
| ⊘ | `sort.effect` | sort | asc/desc on "date" produced identical order |
| ✓ | `info.capabilities` | core | declares 6 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 4 list(s) |
| ✓ | `lists.items` | lists | list "latest" returned 80 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | nextCursor advanced to 80 further item(s) |
| ✓ | `search.items` | search | search returned 80 item(s) |
| ✓ | `search.cursor` | search | nextCursor advanced to 80 further item(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 6 filter(s) |
| ✓ | `filters.effect` | filters | filter "category" changed results (80→80) |
| ✓ | `sort.options` | sort | getSortOptions returned 5 option(s) |
| ✓ | `settings.descriptors` | settings | getSettings returned 1 descriptor(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

## `schalenetwork` — ⚠ (12✓ 2⚠ 0✗ 1⊘)

**6/6 capabilities** · cover 26 KB (320×453) · sampled 8 · failed 0 · bytes min 20 KB / avg 26 KB / median 26 KB / max 30 KB · dims avg 320×453 (max 320×460) · aspect avg 0.71

> pages need a clearance token from a web check

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `direct.pages.threw` | direct | getSeriesPages threw: getSeriesPages threw: Error: [challenge:https%3A%2F%2Fniyaniya.moe%2F\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36\|clearance] Schale Network wants to check this is a person before showing pages |
| ⚠ | `read.details.author` | core | series details have no author |
| ⊘ | `sort.effect` | sort | asc/desc on "date" produced identical order |
| ✓ | `info.capabilities` | core | declares 6 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 4 list(s) |
| ✓ | `lists.items` | lists | list "latest" returned 40 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | nextCursor advanced to 40 further item(s) |
| ✓ | `search.items` | search | search returned 40 item(s) |
| ✓ | `search.cursor` | search | nextCursor advanced to 40 further item(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 6 filter(s) |
| ✓ | `filters.effect` | filters | filter "category" changed results (40→40) |
| ✓ | `sort.options` | sort | getSortOptions returned 5 option(s) |
| ✓ | `settings.descriptors` | settings | getSettings returned 1 descriptor(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

## `myreadingmanga` — ⚠ (5✓ 5⚠ 0✗)

**5/5 capabilities** · cover —

> Cloudflare check needs a browser

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `lists.threw` | lists | lists browse threw: getListItems threw: [challenge:https%3A%2F%2Fmyreadingmanga.info%2Flang%2Fenglish%2F\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `search.threw` | search | getSearchResults threw: getSearchResults threw: [challenge:https%3A%2F%2Fmyreadingmanga.info%2Flang%2Fenglish%2F\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `filters.effect` | filters | applying a filter threw: getSearchResults threw: [challenge:https%3A%2F%2Fmyreadingmanga.info%2Flang%2Fenglish%2F\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `sort.effect` | sort | applying a sort threw: getSearchResults threw: [challenge:https%3A%2F%2Fmyreadingmanga.info%2Flang%2Fenglish%2F\|Mozilla%2F5.0%20(Windows%20NT%2010.0%3B%20Win64%3B%20x64)%20AppleWebKit%2F537.36%20(KHTML%2C%20like%20Gecko)%20Chrome%2F130.0%20Safari%2F537.36] the site wants to check this is a person |
| ⚠ | `read.noSample` | core | no item available to sample the read path (search/lists returned nothing) |
| ✓ | `info.capabilities` | core | declares 5 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 2 list(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 5 filter(s) |
| ✓ | `sort.options` | sort | getSortOptions returned 3 option(s) |
| ✓ | `settings.descriptors` | settings | getSettings returned 1 descriptor(s) |

_Updated 2026-11-21 by the nightly live audit ([`audit.ts`](audit.ts))._
