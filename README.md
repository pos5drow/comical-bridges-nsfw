# comical-bridges-nsfw

Adult-only Comical bridges, published as a registry the app can source.

The SFW bridges live in the sibling [`comical-bridges`](https://github.com/pos5drow/comical-bridges)
repo. Keeping them apart means adding one registry never so much as lists the other's bridges.

## Use this registry in the app

**One-click (if you already have the Comical app installed):**
[Add the NSFW registry](https://porksphere.github.io/comical-app/add-registry?url=https%3A%2F%2Fraw.githubusercontent.com%2Fpos5drow%2Fcomical-bridges-nsfw%2Fmain%2Findex.json)

Or point the app at the `index.json` manually:

```
https://raw.githubusercontent.com/pos5drow/comical-bridges-nsfw/main/index.json
```

Set it as `EXPO_PUBLIC_COMICAL_REGISTRY` in the app's gitignored `apps/mobile/.env.local` (dev
pre-adds a single registry). For the desktop CLI:
`comical registry add https://raw.githubusercontent.com/pos5drow/comical-bridges-nsfw/main/index.json`.

## Status

Live conformance + cover-size metrics, refreshed nightly by [`audit.ts`](audit.ts) (the shared
`@comical/testkit` evaluator run against each real backend). ⚠ = warnings only or a tolerated
flaky/blocked site; ✗ = a real regression; ⊘ = skipped (auth-gated with no credentials, or an
inconclusive sort/filter probe — never counted against a bridge). Per-check results are in
**[`AUDIT.md`](AUDIT.md)**; flaky tags are in [`audit.config.ts`](audit.config.ts).

Every bridge here is adult-gated, so the audit runs them with `adult: "true"` and most are tagged
flaky — these sites IP-gate datacenter (CI runner) addresses even when they work fine from a phone.

<!-- BRIDGE-STATUS:START -->
| Bridge | Status | Capabilities | Avg cover | Notes |
|---|---|---|---|---|
| `nhentai` | ⚠ (13✓ 2⚠ 0✗ 2⊘) | 7/10 | 26 KB (500×660) | Cloudflare / IP-gated from datacenters |
| `e-hentai` | ⚠ (12✓ 3⚠ 0✗ 1⊘) | 6/6 | 21 KB (245×307) | sad-panda / IP + cookie gated from datacenters |
| `hitomi` | ✓ (13✓ 0⚠ 0✗) | 5/8 | 57 KB (478×620) | images need the host /img-proxy (Referer-gated), unavailable in the audit |
| `hentaifox` | ✓ (11✓ 0⚠ 0✗ 1⊘) | 5/5 | 53 KB (250×350) | — |
| `imhentai` | ⚠ (4✓ 5⚠ 0✗) | 5/5 | — | Cloudflare challenges the Bun/Node TLS fingerprint |
| `hentai2read` | ⚠ (4✓ 5⚠ 0✗) | 4/4 | — | Cloudflare challenges the Bun/Node TLS fingerprint |
| `wnacg` | ⚠ (13✓ 1⚠ 0✗ 2⊘) | 5/5 | 27 KB (300×400) | — |
| `jmcomic` | ⚠ (4✓ 4⚠ 0✗) | 4/4 | — | — |
| `kemono` | ⚠ (15✓ 1⚠ 0✗) | 5/5 | 4 KB (160×160) | — |
| `pawchive` | ⚠ (15✓ 2⚠ 0✗) | 5/5 | 8 KB (229×222) | — |
| `hdoujin` | ⚠ (12✓ 2⚠ 0✗ 1⊘) | 6/6 | 21 KB (311×342) | pages need a clearance token from a web check |
| `schalenetwork` | ⚠ (12✓ 1⚠ 0✗ 1⊘) | 6/6 | 23 KB (320×428) | pages need a clearance token from a web check |
| `myreadingmanga` | ⚠ (5✓ 5⚠ 0✗) | 5/5 | — | Cloudflare check needs a browser |

_Updated 2026-11-26 by the nightly live audit ([`audit.ts`](audit.ts))._
<!-- BRIDGE-STATUS:END -->

## Develop

Builds against a **sibling checkout of the Comical monorepo** (`../comical`), resolved via
`tsconfig.json` `paths` — keep the two repos side by side:

```
../
├── comical/                # the runtime monorepo (provides @comical/sdk, CLI, testkit)
└── comical-bridges-nsfw/   # this repo
```

```sh
bun install
bun run build       # build every bridge → .build/<id>/dist/bridge.js  (CJS bundles)
bun test            # unit tests (test/*.test.ts)
bun run audit       # live conformance run against the real backends (add --write to refresh the docs)
```

Publishing is CI's job (`.github/workflows/publish.yml`, on any push touching `src/`) — it holds the
signing key as a repo secret and refuses to publish unsigned. **Don't commit a locally built
registry.** Bun stamps each module's path into the bundle as a comment, so the bytes (and therefore
the SHA-256 clients verify) depend on where the repo sits on disk — a local publish and CI's publish
of identical sources disagree, and the next CI run refuses to overwrite its own bundles. Let CI do
it; the runner's Bun version is pinned so its output only moves when someone means it to.

Regenerating locally is still fine for *inspecting* the output — you need the key at
`registry.key.json` (gitignored) — just don't commit the result:

```sh
COMICAL_KEY=registry.key.json bun run publish:registry
```
