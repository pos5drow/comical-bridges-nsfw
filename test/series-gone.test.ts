/**
 * A gallery the source no longer has throws the contract's series-gone marker; one it only hid from
 * its listings — still readable — comes back with `delisted` instead. Anything short of the source
 * saying so (a 5xx, a page that's merely unavailable to this account) is neither.
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
  const gallery = (extra: Record<string, unknown>) =>
    `var galleryinfo = ${JSON.stringify({ id: 1, title: "Subject", files: [{ hash: "a".repeat(64), name: "1.webp" }], ...extra })}`;

  test("a gallery file the CDN 404s is gone", async () => {
    const gone = host(() => ({ status: 404, body: "<html>404 Not Found</html>" }));
    expect(await goneReason(hitomiFactory(gone).getSeriesDetails("1"))).toBeTruthy();
  });

  test("a blocked gallery is delisted, not gone", async () => {
    const info = await hitomiFactory(host(() => ({ body: gallery({ blocked: 1 }) }))).getSeriesDetails("1");
    expect(info.delisted?.reason).toBeTruthy();
    expect(seriesInfoSchema.parse(info).delisted).toEqual(info.delisted!);
  });

  test("an ordinary gallery carries no notice", async () => {
    const info = await hitomiFactory(host(() => ({ body: gallery({ blocked: 0 }) }))).getSeriesDetails("1");
    expect(info.delisted).toBeUndefined();
  });

  test("a CDN error is not gone", async () => {
    const down = host(() => ({ status: 500, body: "oops" }));
    expect(await goneReason(hitomiFactory(down).getSeriesDetails("1"))).toBeNull();
  });
});

describe("e-hentai", () => {
  const gdata = (meta: Record<string, unknown>) =>
    host(() => ({ body: JSON.stringify({ gmetadata: [{ gid: 1, token: "abc", title: "Subject", ...meta }] }) }));

  test("gdata's unknown-key answer is gone", async () => {
    const gone = host(() => ({ body: JSON.stringify({ gmetadata: [{ gid: 1, error: "Key missing, or incorrect key provided." }] }) }));
    expect(await goneReason(ehentaiFactory(gone).getSeriesDetails("1:abc"))).toBeTruthy();
  });

  test("any other gdata error is not gone", async () => {
    const other = host(() => ({ body: JSON.stringify({ gmetadata: [{ gid: 1, error: "Something else" }] }) }));
    expect(await goneReason(ehentaiFactory(other).getSeriesDetails("1:abc"))).toBeNull();
  });

  test("an expunged gallery is delisted, naming its newer version when there is one", async () => {
    const replaced = await ehentaiFactory(gdata({ expunged: true, current_gid: "2", current_key: "def" })).getSeriesDetails("1:abc");
    expect(replaced.title).toBe("Subject");
    expect(replaced.delisted).toEqual({ reason: "Replaced by a newer version", newerVersionId: "2:def" });

    const expunged = await ehentaiFactory(gdata({ expunged: true, current_gid: "1", current_key: "abc" })).getSeriesDetails("1:abc");
    expect(expunged.delisted).toEqual({ reason: "Expunged" });
  });

  test("a visible gallery carries no notice, even when a newer version exists", async () => {
    const info = await ehentaiFactory(gdata({ expunged: false, current_gid: "2", current_key: "def" })).getSeriesDetails("1:abc");
    expect(info.delisted).toBeUndefined();
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
