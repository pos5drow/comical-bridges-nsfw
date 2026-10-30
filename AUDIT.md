# Bridge audit — detailed results

Per-check results from the live bridge audit — every conformance probe run against the real
backend. ✓ pass · ⚠ warn · ✗ fail · ⊘ skipped (auth-gated with no credentials, or an inconclusive
sort/filter probe — never a defect). Warnings never fail the run; a tolerated flaky/blocked bridge
shows ⚠ even for a hard failure.

## `nhentai` — ⚠ (13✓ 2⚠ 0✗ 2⊘)

**7/10 capabilities** · cover 30 KB (500×626) · sampled 8 · failed 0 · bytes min 19 KB / avg 30 KB / median 28 KB / max 45 KB · dims avg 500×626 (max 500×756) · aspect avg 0.86

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
| ✓ | `direct.pages` | direct | getSeriesPages returned 46 page(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

## `e-hentai` — ⚠ (12✓ 2⚠ 0✗ 1⊘)

**6/6 capabilities** · cover 23 KB (250×357) · sampled 8 · failed 0 · bytes min 12 KB / avg 23 KB / median 23 KB / max 30 KB · dims avg 250×357 (max 250×375) · aspect avg 0.70

> sad-panda / IP + cookie gated from datacenters

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `read.details.description` | core | series details have no description |
| ⚠ | `read.details.genres` | core | series details have no genre tag group (kind: "genre") |
| ⊘ | `favorites.read` | favorites | getFavorites needs credentials (none configured) — skipped: getFavorites threw: Error: [login-required:cookies] Sign in to e-hentai to see your favorites. |
| ✓ | `info.capabilities` | core | declares 6 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 2 list(s) |
| ✓ | `lists.items` | lists | list "popular" returned 68 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | single page (no nextCursor) |
| ✓ | `search.items` | search | search returned 25 item(s) |
| ✓ | `search.cursor` | search | nextCursor advanced to 25 further item(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 3 filter(s) |
| ✓ | `filters.effect` | filters | filter "category" changed results (25→25) |
| ✓ | `settings.descriptors` | settings | getSettings returned 3 descriptor(s) |
| ✓ | `direct.pages` | direct | getSeriesPages returned 194 page(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

## `hitomi` — ⚠ (13✓ 1⚠ 0✗)

**5/8 capabilities** · cover — · sampled 0 · failed 8 · bytes min 0 KB / avg 0 KB / median 0 KB / max 0 KB

> images need the host /img-proxy (Referer-gated), unavailable in the audit

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `read.details.description` | core | series details have no description |
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
| ✓ | `direct.pages` | direct | getSeriesPages returned 161 page(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

_Updated 2026-10-30 by the nightly live audit ([`audit.ts`](audit.ts))._
