/**
 * Kemono bridge — https://kemono.cr, on the kemono engine (`engines/kemono.ts`). Full-size files
 * redirect to `n{1..4}.kemono.cr`, which are often unreachable, so pages default to the thumbnail
 * server (`img.kemono.cr`, 800 px wide); full size is a setting.
 */
import { kemonoSite } from "./engines/kemono";

export default kemonoSite({
  id: "kemono",
  name: "Kemono",
  version: "0.1.4",
  site: "https://kemono.cr",
  thumbnails: "https://img.kemono.cr",
  icons: "https://img.kemono.cr",
  fullImage: (f) => `https://kemono.cr/data${f.path}${f.name ? `?f=${encodeURIComponent(f.name)}` : ""}`,
  defaultImages: "thumbnail",
  imageLabels: { thumbnail: "800 px, always load", full: "Kemono's file servers are often unreachable" },
  rateLimit: { maxConcurrent: 1, minIntervalMs: 1000 },
  assetRateLimit: { maxConcurrent: 4, minIntervalMs: 100 },
  linkHosts: ["kemono.cr", "kemono.su"],
});
