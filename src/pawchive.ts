/**
 * Pawchive bridge — https://pawchive.pw, on the kemono engine (`engines/kemono.ts`).
 *
 * Its file servers ask scripts to identify themselves, keep to one request a second and five
 * downloads at once, and block anything pretending to be a browser. So this bridge sends an honest
 * User-Agent and keeps to those limits, and gets full-size files: the file's own server, or the
 * signed `temp_url` for a file the site only previews. Thumbnails are `img.pawchive.pw`.
 */
import { kemonoSite } from "./engines/kemono";

export default kemonoSite({
  id: "pawchive",
  name: "Pawchive",
  version: "0.1.0",
  site: "https://pawchive.pw",
  thumbnails: "https://img.pawchive.pw",
  icons: "https://pawchive.pw",
  fullImage: (f) => f.tempUrl ?? `${f.server ?? "https://file.pawchive.pw"}/data${f.path}`,
  defaultImages: "full",
  imageLabels: { thumbnail: "800 px", full: "original files" },
  userAgent: "ComicalBridge/0.1 (Comical reader app; Pawchive bridge)",
  rateLimit: { maxConcurrent: 1, minIntervalMs: 1000 },
  assetRateLimit: { maxConcurrent: 4, minIntervalMs: 1000 },
  linkHosts: ["pawchive.pw", "pawchive.st"],
});
