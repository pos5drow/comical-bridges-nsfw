/**
 * Build all bridges to self-contained CJS bundles Comical can load. Output uses the transient
 * `.build/<id>/dist/bridge.js` layout (gitignored) so `comical registry publish --bridges-dir
 * ./.build` discovers them; the published index.json + served bundles land at the repo root.
 * @comical/* is resolved via tsconfig paths (local link to ../comical for now).
 */
import { join } from "node:path";

const ROOT = import.meta.dir;

// Some on-device bridge engines (JSC on iOS, QuickJS on Android) don't define a global `console`,
// so a bridge's diagnostic `console.log`/`console.error` throws a ReferenceError there — e.g.
// e-hentai's `getSeriesPages` failed on-device with `"console" is not defined`. Prepend a no-op
// console shim that only installs when one is missing, so those logs become harmless no-ops on
// device while real consoles (Node/Bun on the server, Hermes in dev) are left untouched.
const CONSOLE_SHIM =
  "if(typeof console==='undefined'){var __noop=function(){};" +
  "globalThis.console={log:__noop,info:__noop,warn:__noop,error:__noop,debug:__noop,trace:__noop};}";

const bridges: Array<{ id: string; src: string }> = [
  { id: "nhentai", src: "nhentai.ts" },
  { id: "e-hentai", src: "ehentai.ts" },
  { id: "hitomi", src: "hitomi.ts" },
];

for (const { id, src } of bridges) {
  const result = await Bun.build({
    entrypoints: [join(ROOT, "src", src)],
    outdir: join(ROOT, ".build", id, "dist"),
    target: "browser",
    format: "cjs",
    naming: "bridge.js",
    minify: false,
    sourcemap: "external",
    banner: CONSOLE_SHIM,
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new AggregateError(result.logs, `${id} bridge build failed`);
  }
  console.log(`✓ built → .build/${id}/dist/bridge.js`);
}
