/**
 * Search pagination + minimum-rating filter for the e-hentai bridge.
 *
 * Regression: e-hentai's next-page link is HTML-encoded, so a search's cursor href is
 * `?f_search=q&amp;next=GID`. The bridge must decode it; otherwise the literal `&amp;` makes
 * `next` a bogus `amp;next` param the site drops, and page 2 silently re-fetches page 1 (the
 * "infinite scroll repeats the same page" bug). Home/popular links carry no extra params, so
 * they never hit this — only searches did.
 *
 * Also covers the Minimum Rating filter (f_srdd), the working stand-in for the (impossible)
 * "Top Rated" sort: e-hentai gallery search can only order by posted date.
 *
 * Drives the public getSearchResults against a mock host that records the listing URLs it fetches.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse } from "@comical/contract";
import factory from "../src/ehentai.ts";

const NEXT_GID = 4005258;

/** A listing page with one gallery card and an HTML-encoded next-page cursor link. */
function listingHtml(query: string): string {
  return `<html><body>
    <a href="https://e-hentai.org/g/123/abc/"><img></a>
    <a href="https://e-hentai.org/g/123/abc/">A Gallery</a>
    <a href="https://e-hentai.org/?f_search=${query}&amp;next=${NEXT_GID}">Next &gt;</a>
  </body></html>`;
}

/** Mock host that records every listing GET URL and answers the gdata API with canned metadata. */
function recordingHost(): { host: HostCapabilities; listingUrls: string[] } {
  const listingUrls: string[] = [];
  const host: HostCapabilities = {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => {
        const ok = (body: string): HttpResponse => ({ url: req.url, status: 200, statusText: "OK", headers: {}, body });
        if (req.url.includes("api.e-hentai.org")) {
          return ok(JSON.stringify({ gmetadata: [{ gid: 123, token: "abc", title: "A Gallery", category: "Manga" }] }));
        }
        listingUrls.push(req.url);
        return ok(listingHtml("naruto"));
      },
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
  return { host, listingUrls };
}

describe("e-hentai search pagination", () => {
  test("page 2 follows the decoded next-cursor instead of re-fetching page 1", async () => {
    const { host, listingUrls } = recordingHost();
    const bridge = factory(host);

    await bridge.getSearchResults("naruto", 1);
    await bridge.getSearchResults("naruto", 2);

    expect(listingUrls).toHaveLength(2);
    const [page1Url, page2Url] = listingUrls;

    // Page 1 starts at the search URL with no cursor.
    expect(page1Url).toContain("f_search=naruto");
    expect(page1Url).not.toContain("next=");

    // Page 2 uses the real, decoded cursor — not a literal &amp; (which the site would ignore),
    // and not a repeat of page 1.
    expect(page2Url).toContain(`next=${NEXT_GID}`);
    expect(page2Url).not.toContain("amp;");
    expect(page2Url).not.toBe(page1Url);
  });

  test("Minimum Rating filter adds the advanced-search star floor", async () => {
    const { host, listingUrls } = recordingHost();

    await factory(host).getSearchResults("naruto", 1, {
      filters: [{ key: "minRating", value: "4" }],
    });

    expect(listingUrls[0]).toContain("advsearch=1");
    expect(listingUrls[0]).toContain("f_srdd=4");
  });

  test("Minimum Rating 'Any' (0) adds no star floor", async () => {
    const { host, listingUrls } = recordingHost();

    await factory(host).getSearchResults("naruto", 1, {
      filters: [{ key: "minRating", value: "0" }],
    });

    expect(listingUrls[0]).not.toContain("f_srdd");
    expect(listingUrls[0]).not.toContain("advsearch");
  });
});
