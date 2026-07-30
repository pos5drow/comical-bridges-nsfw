/**
 * Search pagination + minimum-rating filter for the e-hentai bridge.
 *
 * Regression: e-hentai's next-page link is HTML-encoded, so a search's seek href is
 * `?f_search=q&amp;next=GID`. The bridge must decode it; otherwise the literal `&amp;` makes
 * `next` a bogus `amp;next` param the site drops, and the second page silently re-fetches the
 * first (the "infinite scroll repeats the same page" bug). Home/popular links carry no extra
 * params, so they never hit this — only searches did.
 *
 * The site seeks by `?next=GID`, never by page number, so the bridge puts that whole URL in the
 * contract cursor. These tests pin the consequences: the walk advances, and it advances without
 * the bridge remembering anything between calls.
 *
 * Also covers the Minimum Rating filter (f_srdd), the working stand-in for the (impossible)
 * "Top Rated" sort: e-hentai gallery search can only order by posted date.
 *
 * Drives the public getSearchResults against a mock host that records the listing URLs it fetches.
 */
import { describe, expect, test } from "bun:test";
import type { HostCapabilities, HttpRequest, HttpResponse, SearchRequest } from "@comical/contract";
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

/**
 * Drive the bridge's search on a fresh instance. `getSearchResults` is optional on `Bridge`, so
 * narrowing it here keeps every test below free of non-null assertions — and building a new bridge
 * per call is deliberate: nothing about paging may depend on instance state surviving between reads.
 */
function search(host: HostCapabilities, req: SearchRequest) {
  const bridge = factory(host);
  if (!bridge.getSearchResults) throw new Error("the e-hentai bridge must implement getSearchResults");
  return bridge.getSearchResults(req);
}

describe("e-hentai search pagination", () => {
  test("the second page follows the decoded next-cursor instead of re-fetching the first", async () => {
    // Note both reads go through a *fresh* bridge (see `search`), so this also pins that the cursor
    // is self-contained: there is no per-instance state to lose, and an app restart — or the
    // on-device runtime being torn down between scrolls — resumes rather than re-serving page 1.
    const { host, listingUrls } = recordingHost();

    const first = await search(host, { text: "naruto" });
    expect(first.nextCursor).toBeString();
    await search(host, { text: "naruto", cursor: first.nextCursor as string });

    expect(listingUrls).toHaveLength(2);
    const [page1Url, page2Url] = listingUrls;

    // The first read starts at the search URL with no seek param.
    expect(page1Url).toContain("f_search=naruto");
    expect(page1Url).not.toContain("next=");

    // The second uses the real, decoded seek link — not a literal &amp; (which the site would
    // ignore), and not a repeat of the first page.
    expect(page2Url).toContain(`next=${NEXT_GID}`);
    expect(page2Url).not.toContain("amp;");
    expect(page2Url).not.toBe(page1Url);
  });

  test("a cursor pointing off-site is ignored and the walk restarts", async () => {
    // A cursor is opaque to the host but still attacker-reachable (it round-trips through a URL and
    // a persisted cache), so the bridge only ever follows one back to the site it serves.
    const { host, listingUrls } = recordingHost();
    const offsite = btoa(JSON.stringify({ url: "https://example.invalid/steal" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    await search(host, { text: "naruto", cursor: offsite });

    expect(listingUrls[0]).toContain("f_search=naruto");
    expect(listingUrls[0]).not.toContain("example.invalid");
  });

  test("Minimum Rating filter adds the advanced-search star floor", async () => {
    const { host, listingUrls } = recordingHost();

    await search(host, { text: "naruto", filters: [{ key: "minRating", value: "4" }] });

    expect(listingUrls[0]).toContain("advsearch=1");
    expect(listingUrls[0]).toContain("f_srdd=4");
  });

  test("Minimum Rating 'Any' (0) adds no star floor", async () => {
    const { host, listingUrls } = recordingHost();

    await search(host, { text: "naruto", filters: [{ key: "minRating", value: "0" }] });

    expect(listingUrls[0]).not.toContain("f_srdd");
    expect(listingUrls[0]).not.toContain("advsearch");
  });
});
