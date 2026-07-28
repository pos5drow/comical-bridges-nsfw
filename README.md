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

### Moved from `comical-bridges/nsfw`

These bridges used to be published as the `nsfw/` subtree of `comical-bridges`. Nothing to do:

- that old URL now serves a **signed forwarding tombstone**, so a client already holding it follows
  the move on its next refresh and keeps its installs;
- this registry asserts the old URL as its `movedFrom`, so adding it by hand adopts those installs
  instead of stranding them.

Both halves are signed with the same key as before — that key continuity is the entire proof that
the same operator is behind both URLs, and it's why the migration needs no confirmation from you.

## Status

Live conformance + cover-size metrics, refreshed nightly by [`audit.ts`](audit.ts) (the shared
`@comical/testkit` evaluator run against each real backend). ⚠ = warnings only or a tolerated
flaky/blocked site; ✗ = a real regression; ⊘ = skipped (auth-gated with no credentials, or an
inconclusive sort/filter probe — never counted against a bridge). Per-check results are in
**[`AUDIT.md`](AUDIT.md)**; flaky tags are in [`audit.config.ts`](audit.config.ts).

Every bridge here is adult-gated, so the audit runs them with `adult: "true"` and most are tagged
flaky — these sites IP-gate datacenter (CI runner) addresses even when they work fine from a phone.

<!-- BRIDGE-STATUS:START -->
_Not yet run — the nightly audit fills this in._
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
signing key as a repo secret and refuses to publish unsigned. To regenerate locally you need that key
at `registry.key.json` (gitignored):

```sh
COMICAL_KEY=registry.key.json bun run publish:registry
```
