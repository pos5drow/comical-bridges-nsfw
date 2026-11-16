/**
 * Schale Network bridge — https://niyaniya.moe (API `api.schale.network`), on the engine it shares
 * with HDoujin (`engines/schale.ts`). English and Chinese galleries; pages need the site's
 * clearance token, which a web check of its home page provides.
 */
import { schaleSite } from "./engines/schale";

export default schaleSite({
  id: "schalenetwork",
  name: "Schale Network",
  version: "0.1.3",
  site: "https://niyaniya.moe",
  apiDomain: "schale.network",
  languages: [
    ["english", "English"],
    ["chinese", "Chinese"],
  ],
  linkHosts: ["niyaniya.moe"],
});
