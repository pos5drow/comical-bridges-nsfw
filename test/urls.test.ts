/** The engine-neutral URL helpers, checked against the platform's own `URL`. */
import { describe, expect, test } from "bun:test";
import { absoluteUrl, hostOf, pathOf, queryParam, withQuery } from "../src/core/urls.ts";

describe("absoluteUrl", () => {
  const base = "https://www.site.test/manga/series/page?x=1#top";
  for (const ref of ["/a/b.jpg", "c.jpg", "./c.jpg", "../d.jpg", "../../e/f.jpg", "//cdn.test/g.png", "?q=2", "#h", "/x?y=1#z", "https://other.test/p"]) {
    test(`${ref} resolves as URL would`, () => {
      expect(absoluteUrl(ref, base)).toBe(new URL(ref, base).href);
    });
  }
  test("nothing to resolve", () => {
    expect(absoluteUrl("  ", base)).toBeUndefined();
    expect(absoluteUrl("/a", "not a url")).toBeUndefined();
    expect(absoluteUrl("data:image/gif;base64,R0", base)).toBe("data:image/gif;base64,R0");
  });
});

describe("parts and queries", () => {
  test("host, path and a parameter", () => {
    expect(hostOf("https://User@WWW.Site.test:8443/a?b=1")).toBe("www.site.test");
    expect(pathOf("https://site.test")).toBe("/");
    expect(pathOf("https://site.test/a/b?c")).toBe("/a/b");
    expect(queryParam("https://site.test/a?g=12&x=y", "g")).toBe("12");
    expect(queryParam("https://site.test/a", "g")).toBeNull();
    expect(hostOf("/relative")).toBeUndefined();
  });

  test("withQuery sets and removes, keeping order, path and hash", () => {
    expect(withQuery("https://s.test/t/x?w=320&k=1#f", { w: null, token: "a b" })).toBe("https://s.test/t/x?k=1&token=a+b#f");
    expect(withQuery("https://s.test/t", { chapters: "all", order: "desc" })).toBe("https://s.test/t?chapters=all&order=desc");
    expect(withQuery("https://s.test/t?w=1", { w: null })).toBe("https://s.test/t");
  });
});
