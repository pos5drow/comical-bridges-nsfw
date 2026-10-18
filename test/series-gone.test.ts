/**
 * A gallery the source no longer has throws the contract's series-gone marker. One it only hid from
 * its listings is still readable, so it is not gone, and neither is anything short of the source
 * saying so (a 5xx, a page that's merely unavailable to this account).
 *
 * Each bridge gets a mock host answering by URL with canned responses shaped like the live ones.
 */
import { describe, expect, test } from "bun:test";
import { type HostCapabilities, type HttpRequest, type HttpResponse, parseSeriesGone, seriesInfoSchema } from "@comical/contract";
import ehentaiFactory, { galleryGone } from "../src/ehentai.ts";
import hitomiFactory from "../src/hitomi.ts";
import nhentaiFactory from "../src/nhentai.ts";

type Reply = Partial<HttpResponse> & { body: string };

function host(route: (req: HttpRequest) => Reply): HostCapabilities {
  return {
    network: {
      request: async (req: HttpRequest): Promise<HttpResponse> => ({
        url: req.url,
        status: 200,
        statusText: "OK",
        headers: {},
        ...route(req),
      }),
    },
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings: {},
  };
}

/** The series-gone reason a rejected call carried, or null when it failed some other way. */
async function goneReason(call: Promise<unknown>): Promise<string | null> {
  try {
    await call;
  } catch (e) {
    return parseSeriesGone(e instanceof Error ? e.message : String(e))?.reason ?? null;
  }
  throw new Error("expected the call to reject");
}

describe("nhentai", () => {
  test("a 404 saying the gallery isn't found is gone", async () => {
    const gone = host(() => ({ status: 404, body: '{"error":"Gallery not found"}' }));
    expect(await goneReason(nhentaiFactory(gone).getSeriesDetails("1"))).toBeTruthy();
    expect(await goneReason(nhentaiFactory(gone).getSeriesPages!("1"))).toBeTruthy();
  });

  test("a 404 that doesn't name the gallery is not gone", async () => {
    const other = host(() => ({ status: 404, body: "<html>Not Found</html>" }));
    expect(await goneReason(nhentaiFactory(other).getSeriesDetails("1"))).toBeNull();
  });
});

describe("hitomi", () => {
  test("a gallery file the CDN 404s is gone", async () => {
    const gone = host(() => ({ status: 404, body: "<html>404 Not Found</html>" }));
    expect(await goneReason(hitomiFactory(gone).getSeriesDetails("1"))).toBeTruthy();
  });

  test("a CDN error is not gone", async () => {
    const down = host(() => ({ status: 500, body: "oops" }));
    expect(await goneReason(hitomiFactory(down).getSeriesDetails("1"))).toBeNull();
  });
});

describe("e-hentai", () => {
  const gdata = (meta: Record<string, unknown>) =>
    host(() => ({ body: JSON.stringify({ gmetadata: [{ gid: 1, token: "abc", title: "Subject", ...meta }] }) }));

  /** Gallery 1 superseded by gallery 2; `newer` is what a lookup of gallery 2 answers. */
  const superseded = (newer: () => Reply) =>
    host((req) => {
      const [[gid]] = (JSON.parse(String(req.body)) as { gidlist: [number, string][] }).gidlist;
      if (gid === 2) return newer();
      return { body: JSON.stringify({ gmetadata: [{ gid: 1, token: "abc", title: "Subject", expunged: true, current_gid: "2", current_key: "def" }] }) };
    });

  test("gdata's unknown-key answer is gone", async () => {
    const gone = host(() => ({ body: JSON.stringify({ gmetadata: [{ gid: 1, error: "Key missing, or incorrect key provided." }] }) }));
    expect(await goneReason(ehentaiFactory(gone).getSeriesDetails("1:abc"))).toBeTruthy();
  });

  test("any other gdata error is not gone", async () => {
    const other = host(() => ({ body: JSON.stringify({ gmetadata: [{ gid: 1, error: "Something else" }] }) }));
    expect(await goneReason(ehentaiFactory(other).getSeriesDetails("1:abc"))).toBeNull();
  });

  test("a superseded gallery reads normally, with its newer version as a related card", async () => {
    const bridge = ehentaiFactory(superseded(() => ({
      body: JSON.stringify({ gmetadata: [{ gid: 2, token: "def", title: "Subject (Revised)", thumb: "https://ehgt.org/t/ab/cd/x_250.jpg" }] }),
    })));
    const info = seriesInfoSchema.parse(await bridge.getSeriesDetails("1:abc"));
    expect(info.title).toBe("Subject");
    expect(info.relatedSeriesGroups).toHaveLength(1);
    const [group] = info.relatedSeriesGroups!;
    expect(group).toMatchObject({ label: "Newer version", kind: "alternative" });
    expect(group.series).toHaveLength(1);
    expect(group.series[0]).toMatchObject({ id: "2:def", title: "Subject (Revised)" });
    expect(group.series[0].thumbnailUrl).toBeTruthy();
  });

  test("a failed lookup of the newer version still links it, under this gallery's title", async () => {
    const info = await ehentaiFactory(superseded(() => ({ status: 500, body: "oops" }))).getSeriesDetails("1:abc");
    expect(info.relatedSeriesGroups?.[0]?.series).toEqual([{ id: "2:def", title: "Subject" }]);
  });

  test("an expunged gallery with no newer version reads normally, with no rail", async () => {
    const info = await ehentaiFactory(gdata({ expunged: true, current_gid: "1", current_key: "abc" })).getSeriesDetails("1:abc");
    expect(info.title).toBe("Subject");
    expect(info.relatedSeriesGroups).toBeUndefined();
  });

  test("a copyright takedown page is gone, with the claimant as the reason", () => {
    const html = '<html><body><div class="d"><p>This gallery is unavailable due to a copyright claim by Some Publisher &amp; Co.</p></div></body></html>';
    expect(parseSeriesGone(galleryGone(html)!.message)?.reason).toBe("Copyright claim by Some Publisher & Co");
  });

  test("the bare unknown-key page is gone", () => {
    expect(galleryGone("Key missing, or incorrect key provided.")).toBeDefined();
  });

  test("the generic removed-or-unavailable page is not gone — it can mean missing access", () => {
    expect(galleryGone("<html><p>This gallery has been removed or is unavailable.</p></html>")).toBeUndefined();
  });

  test("a full gallery page that merely quotes a notice is not gone", () => {
    const page = `<html>${"x".repeat(20_000)}<div class="c6">unavailable due to a copyright claim by X.</div></html>`;
    expect(galleryGone(page)).toBeUndefined();
  });

  test("getSeriesPages throws gone for a taken-down gallery", async () => {
    const takedown = host(() => ({ body: "<p>This gallery is unavailable due to a copyright claim by X.</p>" }));
    expect(await goneReason(ehentaiFactory(takedown).getSeriesPages!("1:abc"))).toBe("Copyright claim by X");
  });
});
