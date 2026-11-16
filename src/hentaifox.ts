/**
 * HentaiFox bridge — https://hentaifox.com, on the galleryadults engine (`engines/galleryadults.ts`).
 * Lists page with `/pag/{n}/`, search is a plain query with the language appended, and images come
 * from the cover's host (`i{n}.hentaifox.com`).
 */
import { galleryAdults } from "./engines/galleryadults";

export default galleryAdults({
  id: "hentaifox",
  name: "HentaiFox",
  version: "0.1.3",
  site: "https://hentaifox.com",
  languages: {
    en: ["English", "english"],
    ja: ["Japanese", "japanese"],
    zh: ["Chinese", "chinese"],
    ko: ["Korean", "korean"],
    all: ["All languages", ""],
  },
  defaultLanguage: "en",
  paging: "pag",
  search: "basic",
  coverSelector: ".gallery_top .cover img",
  imageHosts: ["hentaifox.com"],
});
