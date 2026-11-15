/**
 * HDoujin bridge — https://hdoujin.org (API `api.hdoujin.org`), on the engine it shares with
 * Schale Network (`engines/schale.ts`). Pages need the site's clearance token, which a web check of
 * its home page provides.
 */
import { schaleSite } from "./engines/schale";

export default schaleSite({
  id: "hdoujin",
  name: "HDoujin",
  version: "0.1.1",
  site: "https://hdoujin.org",
  apiDomain: "hdoujin.org",
  languages: [
    ["english", "English"],
    ["japanese", "Japanese"],
    ["chinese", "Chinese"],
    ["korean", "Korean"],
    ["spanish", "Spanish"],
  ],
  linkHosts: ["hdoujin.org"],
});
