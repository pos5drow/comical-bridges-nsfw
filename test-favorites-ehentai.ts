/**
 * Favorites round-trip against a REAL e-hentai / exhentai account — self-restoring.
 *
 * Reads credentials from a gitignored `.creds.ehentai.json`:
 *   {"cookies":"ipb_member_id=…; ipb_pass_hash=…[; igneous=…]", "exhentai": false}
 * so they never touch the shell history or any transcript. Run AFTER `bun run build`:
 *
 *   bun run test-favorites-ehentai.ts
 *
 * What it does (and undoes):
 *   1. getFavorites() → baseline snapshot (requires the cookies)
 *   2. pick a Popular gallery you do NOT already have favorited
 *   3. addFavorite(it) → getFavorites()/isFavorite() assert it appears
 *   4. removeFavorite(it) → getFavorites()/isFavorite() assert your list is back to baseline
 * If a step fails mid-way it tells you what (if anything) to undo.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadBridge } from "@comical/core";
import { createBunHost } from "@comical/host-bun";

const ROOT = import.meta.dir;
const credsPath = join(ROOT, ".creds.ehentai.json");
if (!existsSync(credsPath)) {
  console.error(
    `✗ no ${credsPath} — create it with {"cookies":"ipb_member_id=…; ipb_pass_hash=…","exhentai":false} (gitignored).`,
  );
  process.exit(2);
}
const { cookies, exhentai } = JSON.parse(readFileSync(credsPath, "utf8")) as {
  cookies?: string;
  exhentai?: boolean;
};
if (!cookies) {
  console.error("✗ .creds.ehentai.json must contain a non-empty cookies string.");
  process.exit(2);
}

const bundle = join(ROOT, ".build", "e-hentai", "dist", "bridge.js");
if (!existsSync(bundle)) {
  console.error(`✗ no built bundle at ${bundle} — run \`bun run build\` first.`);
  process.exit(2);
}

const bridge = loadBridge({
  code: readFileSync(bundle, "utf8"),
  capabilities: createBunHost({
    bridgeId: "e-hentai",
    settings: { cookies, exhentai: exhentai ?? false },
  }),
  expectedId: "e-hentai",
});

const ids = (r: { items: { id: string }[] }) => new Set(r.items.map((i) => i.id));
let added: string | undefined; // track for cleanup messaging on failure

try {
  // 1. Baseline.
  console.log("reading favorites…");
  const baseline = await bridge.getFavorites!(1);
  const baseIds = ids(baseline);
  console.log(`✓ getFavorites → ${baseline.items.length} existing favorite(s) on page 1`);

  // 2. Pick a Popular gallery not already favorited.
  const popular = await bridge.getListItems!("popular", 1);
  const candidate = popular.items.find((s) => !baseIds.has(s.id));
  if (!candidate) {
    console.log("• every Popular gallery is already in your favorites — skipping the mutation test.");
    process.exit(0);
  }
  console.log(`  test gallery: "${candidate.title}" (${candidate.id})`);

  // 3. Add → verify present (via getFavorites and isFavorite).
  await bridge.addFavorite!(candidate.id);
  added = candidate.id;
  const afterAdd = await bridge.getFavorites!(1);
  if (!ids(afterAdd).has(candidate.id)) throw new Error("addFavorite did not show up in getFavorites");
  if (!(await bridge.isFavorite!(candidate.id))) throw new Error("isFavorite returned false after addFavorite");
  console.log(`✓ addFavorite → now ${afterAdd.items.length} favorite(s), test gallery present (isFavorite ✓)`);

  // 4. Remove → verify gone + list restored to baseline.
  await bridge.removeFavorite!(candidate.id);
  added = undefined;
  const afterRemove = await bridge.getFavorites!(1);
  const restoredIds = ids(afterRemove);
  if (restoredIds.has(candidate.id)) throw new Error("removeFavorite left the gallery in the list");
  if (await bridge.isFavorite!(candidate.id)) throw new Error("isFavorite returned true after removeFavorite");
  const sameAsBaseline =
    restoredIds.size === baseIds.size && [...baseIds].every((id) => restoredIds.has(id));
  if (!sameAsBaseline) throw new Error("favorites list does not match the original baseline after cleanup");
  console.log(`✓ removeFavorite → back to ${afterRemove.items.length} favorite(s), baseline restored (isFavorite ✓)`);

  console.log("\nPASS — favorites round-trip works (read, add, remove, isFavorite) and your account is unchanged.");
} catch (e) {
  console.error(`\n✗ FAIL: ${e instanceof Error ? e.message : e}`);
  if (added) console.error(`  ⚠ cleanup: the test gallery ${added} may still be favorited — remove it manually.`);
  process.exit(1);
}
