/**
 * Nightly LIVE bridge audit. For every built bridge it runs the shared conformance evaluator
 * against the real backend AND measures thumbnail sizes, then prints a status table. With `--write`
 * it rewrites the README's BRIDGE-STATUS block (the summary) AND regenerates `AUDIT.md` (the
 * per-check detail). Exits non-zero ONLY if a NON-flaky bridge has a real (non-transient) failure —
 * flaky/blocked bridges show ⚠, never fail the run.
 *
 * The harness itself lives in `@comical/testkit` (`runBridgeAudit`); this file is just the repo's
 * wiring — where bundles live, which host to run them on, and where the two documents are written.
 *
 *   bun run audit            # print the summary table
 *   bun run audit --write    # + update README.md and AUDIT.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createBunHost } from "@comical/host-bun";
import { applyStatusBlock, defaultAssetFetcher, runBridgeAudit } from "@comical/testkit";
import { AUDIT } from "./audit.config.ts";

const ROOT = import.meta.dir;
const README = join(ROOT, "README.md");
const DETAILS = join(ROOT, "AUDIT.md");

const result = await runBridgeAudit({
  bridges: AUDIT,
  readBundle: (id) => readFileSync(join(ROOT, ".build", id, "dist", "bridge.js"), "utf8"),
  createCapabilities: (id, settings) => createBunHost({ bridgeId: id, settings }),
  fetchAsset: defaultAssetFetcher,
  onProgress: (id) => process.stderr.write(`auditing ${id}…\n`),
  stamp: `_Updated ${new Date().toISOString().slice(0, 10)} by the nightly live audit ([\`audit.ts\`](audit.ts))._`,
});

console.log(result.summaryMarkdown);

if (process.argv.includes("--write")) {
  writeFileSync(README, applyStatusBlock(readFileSync(README, "utf8"), result.summaryMarkdown));
  writeFileSync(DETAILS, result.detailsMarkdown);
  process.stderr.write("README BRIDGE-STATUS block + AUDIT.md updated.\n");
}

if (result.hardFailures.length > 0) {
  process.stderr.write(`\nHARD FAIL (untolerated): ${result.hardFailures.join(", ")}\n`);
  process.exit(1);
}
