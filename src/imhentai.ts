/**
 * IMHentai bridge — https://imhentai.xxx, on the galleryadults engine (`engines/galleryadults.ts`).
 * Lists page with `?page={n}`, search takes sort and language flags, and images are sharded across
 * `m{n}.imhentai.xxx` (the gallery's `load_server`).
 */
import { galleryAdults } from "./engines/galleryadults";

export default galleryAdults({
  id: "imhentai",
  name: "IMHentai",
  version: "0.1.2",
  site: "https://imhentai.xxx",
  languages: {
    en: ["English", "english"],
    ja: ["Japanese", "japanese"],
    es: ["Spanish", "spanish"],
    fr: ["French", "french"],
    ko: ["Korean", "korean"],
    de: ["German", "german"],
    ru: ["Russian", "russian"],
    all: ["All languages", ""],
  },
  defaultLanguage: "en",
  paging: "query",
  search: "flags",
  languageFlags: { english: "en", japanese: "jp", spanish: "es", french: "fr", korean: "kr", german: "de", russian: "ru" },
  coverSelector: ".left_cover img",
  imageHosts: ["imhentai.xxx"],
});
