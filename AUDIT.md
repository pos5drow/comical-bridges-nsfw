# Bridge audit — detailed results

Per-check results from the live bridge audit — every conformance probe run against the real
backend. ✓ pass · ⚠ warn · ✗ fail · ⊘ skipped (auth-gated with no credentials, or an inconclusive
sort/filter probe — never a defect). Warnings never fail the run; a tolerated flaky/blocked bridge
shows ⚠ even for a hard failure.

## `nhentai` — ⚠ (13✓ 2⚠ 0✗ 2⊘)

**7/10 capabilities** · cover 27 KB (500×712) · sampled 8 · failed 0 · bytes min 14 KB / avg 27 KB / median 28 KB / max 40 KB · dims avg 500×712 (max 500×773) · aspect avg 0.70

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
| ✓ | `direct.pages` | direct | getSeriesPages returned 199 page(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

## `e-hentai` — ⚠ (12✓ 2⚠ 0✗ 1⊘)

**6/6 capabilities** · cover 21 KB (245×311) · sampled 8 · failed 0 · bytes min 11 KB / avg 21 KB / median 20 KB / max 31 KB · dims avg 245×311 (max 250×375) · aspect avg 0.83

> sad-panda / IP + cookie gated from datacenters

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ⚠ | `read.details.author` | core | series details have no author |
| ⚠ | `read.details.genres` | core | series details have no genre tag group (kind: "genre") |
| ⊘ | `favorites.read` | favorites | getFavorites needs credentials (none configured) — skipped: getFavorites threw: Error: favorites require your e-hentai session cookies — on a logged-in browser open DevTools → Application → Cookies and paste ipb_member_id and ipb_pass_hash into this bridge's settings |
| ✓ | `info.capabilities` | core | declares 6 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 2 list(s) |
| ✓ | `lists.items` | lists | list "popular" returned 86 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | single page (no nextCursor) |
| ✓ | `search.items` | search | search returned 25 item(s) |
| ✓ | `search.cursor` | search | nextCursor advanced to 25 further item(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 3 filter(s) |
| ✓ | `filters.effect` | filters | filter "category" changed results (25→25) |
| ✓ | `settings.descriptors` | settings | getSettings returned 3 descriptor(s) |
| ✓ | `direct.pages` | direct | getSeriesPages returned 151 page(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

## `hitomi` — ✓ (13✓ 0⚠ 0✗)

**5/8 capabilities** · cover — · sampled 0 · failed 8 · bytes min 0 KB / avg 0 KB / median 0 KB / max 0 KB

> images need the host /img-proxy (Referer-gated), unavailable in the audit

| Result | Check | Capability | Detail |
|:--:|---|---|---|
| ✓ | `info.capabilities` | core | declares 8 capability(ies) |
| ✓ | `lists.catalog` | lists | getLists returned 3 list(s) |
| ✓ | `lists.items` | lists | list "popular-today" returned 24 item(s) |
| ✓ | `lists.idStability` | lists | list item ids are stable across calls |
| ✓ | `lists.cursor` | lists | nextCursor advanced to 24 further item(s) |
| ✓ | `search.items` | search | search returned 24 item(s) |
| ✓ | `search.cursor` | search | nextCursor advanced to 24 further item(s) |
| ✓ | `filters.descriptors` | filters | getFilters returned 7 filter(s) |
| ✓ | `filters.effect` | filters | filter "type" changed results (24→24) |
| ✓ | `sort.options` | sort | getSortOptions returned 7 option(s) |
| ✓ | `sort.effect` | sort | sort "latest" reorders results (asc ≠ desc) |
| ✓ | `direct.pages` | direct | getSeriesPages returned 75 page(s) |
| ✓ | `read.detailsRoundTrip` | core | details round-trip the sampled id |

_Updated 2026-08-06 by the nightly live audit ([`audit.ts`](audit.ts))._
