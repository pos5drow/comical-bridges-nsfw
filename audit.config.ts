/**
 * Per-bridge config for the nightly live audit (`audit.ts`). Keyed by bridge id (= the `.build/<id>`
 * dir). `flaky` marks a bridge whose LIVE failures shouldn't redden the run — e.g. it Cloudflare-walls
 * or rate-limits datacenter (GitHub runner) IPs even though it works from a phone. For a flaky bridge,
 * even a real `fail` is downgraded to a warning in the status (transient/blocked throws are already
 * downgraded by the harness itself — see `isTransientError`). The string is the human reason shown.
 *
 * The shape lives in `@comical/testkit` (`BridgeAuditConfig`) — it's ops/test config, deliberately
 * OUT of the bridge contract.
 */
import type { BridgeAuditConfig } from "@comical/testkit";

export const AUDIT: Record<string, BridgeAuditConfig> = {
  // Every bridge here is adult-only, so the live run needs the adult gate open or searches return
  // nothing and every probe fails for the wrong reason.
  nhentai: { searchQuery: "the", settings: { adult: "true" }, flaky: "Cloudflare / IP-gated from datacenters" },
  // "the" isn't a searchable token on e-hentai's tag-tokenized search (returns 0); "translated" is a
  // near-universal tag that reliably returns hits.
  "e-hentai": { searchQuery: "translated", settings: { adult: "true" }, flaky: "sad-panda / IP + cookie gated from datacenters" },
  // Structural checks run live; images are Referer-gated and only load through the host's /img-proxy
  // (absent in this harness), so the cover/asset probes can't pass here — tolerated as ⚠.
  hitomi: { searchQuery: "full color", settings: { adult: "true" }, flaky: "images need the host /img-proxy (Referer-gated), unavailable in the audit" },
};
