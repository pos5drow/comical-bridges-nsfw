/**
 * Publish this repo as a single Comical registry, served from the repo root via raw.githubusercontent
 * (`index.json` + `bridges/**`).
 *
 * `--moved-from` names the retired URL these bridges were served from, so a client re-adding this
 * registry by hand adopts its existing installs instead of stranding them. That URL is gone now — no
 * forwarding tombstone is served there anymore — so adoption is the only path back from it. See
 * "Moving a registry" in the comical README.
 *
 * **The signing key must stay the one the predecessor URL used.** Key continuity is the only proof
 * the same operator is behind both URLs, and it's what lets the predecessor be adopted without
 * asking the user to confirm anything.
 *
 * Uses the local comical CLI (../comical) for now — once `comical` ships to npm this becomes
 * `bunx comical …`.
 *
 *   [COMICAL_BASE_URL=https://raw.githubusercontent.com/<owner>/comical-bridges-nsfw/main] \
 *     [COMICAL_KEY=registry.key.json] bun run publish:registry
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir;
const cli = join(ROOT, "..", "comical", "packages", "cli", "src", "index.ts");
const baseUrl =
  process.env.COMICAL_BASE_URL ??
  "https://raw.githubusercontent.com/pos5drow/comical-bridges-nsfw/main";

/** The retired URL these bridges were served from. Asserted as this registry's predecessor. */
const PREDECESSOR = "https://raw.githubusercontent.com/pos5drow/comical-bridges/main/nsfw/index.json";

const args = [
  "run", cli, "registry", "publish",
  "--bridges-dir", join(ROOT, ".build"),
  "--base-url", baseUrl,
  "--out", ROOT,
  "--display-name", "NSFW",
  "--moved-from", PREDECESSOR,
];
if (process.env.COMICAL_KEY) args.push("--key", process.env.COMICAL_KEY);

const proc = Bun.spawn(["bun", ...args], { stdout: "inherit", stderr: "inherit" });
const code = await proc.exited;
if (code !== 0) process.exit(code);

// Deterministic ordering. The CLI emits bridges in filesystem-discovery order, which differs between
// machines/CI and reshuffles index.json on every publish — noisy diffs and a fresh commit each time
// from the publish CI. Sort by id so republishing byte-identical bundles is a no-op except the
// `updated` timestamp (which CI ignores). Matches the CLI's exact serialization (2-space indent, no
// trailing newline) so this reorders and nothing else.
const indexPath = join(ROOT, "index.json");
const index = JSON.parse(readFileSync(indexPath, "utf8")) as {
  bridges?: { id: string }[];
  trackers?: { id: string }[];
};
const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
index.bridges?.sort(byId);
index.trackers?.sort(byId);
writeFileSync(indexPath, JSON.stringify(index, null, 2));

process.exit(0);
