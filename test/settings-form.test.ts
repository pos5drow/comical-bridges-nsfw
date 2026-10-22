/**
 * Live settings forms (`loadSettings` / `runSettingAction`, contract 2.1): e-hentai names its favorite
 * slots after the account's own categories, signs in on the site and checks the session; nhentai tests an API key.
 */
import { describe, expect, test } from "bun:test";
import { parseLoginRequired, type HostCapabilities, type HttpRequest, type SettingDescriptor, type SettingValue } from "@comical/contract";
import ehentai, { parseFavoriteCategories } from "../src/ehentai.ts";
import nhentai from "../src/nhentai.ts";

type Answer = { status?: number; body: string };

/** A host whose every request is answered by `respond(req)`, recording what was fetched. */
function host(settings: Record<string, SettingValue>, respond: (req: HttpRequest) => Answer = () => ({ body: "" })) {
  const urls: string[] = [];
  const caps: HostCapabilities = {
    network: {
      request: async (req) => {
        urls.push(req.url);
        const { status = 200, body } = respond(req);
        return { url: req.url, status, statusText: "", headers: {}, body };
      },
    },
    storage: {
      get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [],
      secure: { get: async () => undefined, set: async () => {}, delete: async () => {}, keys: async () => [] },
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    settings,
  };
  return { caps, urls };
}

/** favorites.php's category bar, the way the site draws it: a `.fp` block per slot, then "Show All". */
function favoritesPage(names: string[]): string {
  const slot = (name: string, i: number, cls = "fp") =>
    `<div class="${cls}" onclick="document.location='/favorites.php?favcat=${i}'"><div>${i * 1100}</div>` +
    `<div class="i" style="background-position:0px -${i * 19 + 2}px" title="${name}"></div><div>${name}</div></div>`;
  return `<div class="nosel">${names.map((n, i) => slot(n, i)).join("")}${slot("Show All Favorites", 10, "fp fps")}</div>`;
}
const NAMES = ["Reading", "Done &amp; dusted", "2", "3", "4", "5", "6", "7", "8", "Later"];
const COOKIES = { cookies: "ipb_member_id=1; ipb_pass_hash=abc" };

describe("parseFavoriteCategories", () => {
  test("reads each slot's name and count", () => {
    const cats = parseFavoriteCategories(favoritesPage(NAMES))!;
    expect(cats).toHaveLength(10);
    expect(cats[1]).toEqual({ name: "Done & dusted", count: 1100 });
    expect(cats[9]!.name).toBe("Later");
  });

  test("null for a page without all ten", () => {
    expect(parseFavoriteCategories(favoritesPage(NAMES.slice(0, 4)).replace(/fp fps/, "x"))).toBeNull();
    expect(parseFavoriteCategories("<p>nothing</p>")).toBeNull();
  });
});

describe("e-hentai loadSettings", () => {
  const favcat = (form: Awaited<ReturnType<NonNullable<ReturnType<typeof ehentai>["loadSettings"]>>>) =>
    form.sections.flatMap((s) => s.items).find((i) => i.key === "favcat") as Extract<SettingDescriptor, { type: "enum" }>;

  test("signed out, it fetches nothing and numbers the slots", async () => {
    const { caps, urls } = host({});
    const form = await ehentai(caps).loadSettings!();
    expect(urls).toEqual([]);
    expect(favcat(form).options[3]!.label).toBe("3");
    expect(form.sections.map((s) => s.title)).toEqual(["Account", "Site", "Favorites"]);
  });

  test("signed in, the slots carry the account's names", async () => {
    const { caps, urls } = host(COOKIES, () => ({ body: favoritesPage(NAMES) }));
    const form = await ehentai(caps).loadSettings!();
    expect(urls).toEqual(["https://e-hentai.org/favorites.php"]);
    expect(favcat(form).options[0]).toEqual({ value: "0", label: "Reading (0)" });
    expect(favcat(form).options[9]).toEqual({ value: "9", label: "Later (9900)" });
  });

  test("still opens when the site can't be read", async () => {
    const { caps } = host(COOKIES, () => ({ status: 503, body: "" }));
    const form = await ehentai(caps).loadSettings!();
    expect(favcat(form).options[0]!.label).toBe("0");
    expect(form.sections[2]!.footer).toContain("shown by number");
  });

  test("says when the cookies came back signed out", async () => {
    const { caps } = host(COOKIES, () => ({ body: '<input name="UserName">' }));
    expect((await ehentai(caps).loadSettings!()).sections[2]!.footer).toContain("signed out");
  });
});

describe("e-hentai sign-in", () => {
  test("signs in on the forums' own page and keeps the session cookies", async () => {
    const form = await ehentai(host({}).caps).loadSettings!();
    const account = form.sections[0]!.items[0] as SettingDescriptor;
    expect(account).toMatchObject({ type: "web-login", key: "cookies", cookies: ["ipb_member_id", "ipb_pass_hash"] });
  });

  test("favorites without a session ask for the sign-in", async () => {
    const { caps, urls } = host({});
    const err = await ehentai(caps).getFavorites!().catch((e: Error) => e);
    expect(parseLoginRequired((err as Error).message)?.key).toBe("cookies");
    expect(urls).toEqual([]);
  });

  test("a session the site no longer honours asks for the sign-in again", async () => {
    const { caps } = host(COOKIES, () => ({ body: "This page requires you to log on." }));
    const err = await ehentai(caps).getFavorites!().catch((e: Error) => e);
    expect(parseLoginRequired((err as Error).message)?.reason).toContain("Sign in again");
  });

  test("a whole jar from the sign-in works the same as a paste", async () => {
    const { caps } = host({ cookies: "ipb_member_id=1; ipb_pass_hash=abc; ipb_session_id=x; sk=y" }, () => ({
      body: favoritesPage(NAMES),
    }));
    expect((await ehentai(caps).runSettingAction!("test-login")).ok).toBe(true);
  });
});

describe("e-hentai Check sign-in", () => {
  test("accepted cookies report the account's favorites", async () => {
    const { caps } = host(COOKIES, () => ({ body: favoritesPage(NAMES) }));
    expect(await ehentai(caps).runSettingAction!("test-login")).toEqual({ ok: true, message: "Signed in · 49500 favorites" });
  });

  test("a signed-out answer is a failed check, not an error", async () => {
    const { caps } = host(COOKIES, () => ({ body: "This page requires you to log on." }));
    expect((await ehentai(caps).runSettingAction!("test-login")).ok).toBe(false);
  });

  test("ExHentai's blank page names what's missing", async () => {
    const { caps } = host({ ...COOKIES, exhentai: true }, () => ({ body: "" }));
    const result = await ehentai(caps).runSettingAction!("test-login");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("igneous");
  });

  test("signed out it asks for a sign-in and fetches nothing", async () => {
    const { caps, urls } = host({});
    expect((await ehentai(caps).runSettingAction!("test-login")).ok).toBe(false);
    expect(urls).toEqual([]);
  });

  test("an unknown action throws", async () => {
    await expect(ehentai(host(COOKIES).caps).runSettingAction!("nope")).rejects.toThrow("nope");
  });
});

describe("nhentai Test API key", () => {
  test("offers the key and the button together", async () => {
    const form = await nhentai(host({}).caps).loadSettings!();
    expect(form.sections[0]!.items.map((i) => i.key)).toEqual(["apiKey", "test-key"]);
  });

  test("a key the API accepts", async () => {
    const { caps, urls } = host({ apiKey: "k" }, () => ({ body: "{}" }));
    expect(await nhentai(caps).runSettingAction!("test-key")).toEqual({ ok: true, message: "API key accepted" });
    expect(urls[0]).toContain("/favorites");
  });

  test("a key the API rejects", async () => {
    const { caps } = host({ apiKey: "k" }, () => ({ status: 401, body: "{}" }));
    expect((await nhentai(caps).runSettingAction!("test-key")).ok).toBe(false);
  });

  test("any other failure is an error, not a verdict on the key", async () => {
    const { caps } = host({ apiKey: "k" }, () => ({ status: 500, body: "" }));
    await expect(nhentai(caps).runSettingAction!("test-key")).rejects.toThrow("500");
  });

  test("no key, no request", async () => {
    const { caps, urls } = host({});
    expect((await nhentai(caps).runSettingAction!("test-key")).ok).toBe(false);
    expect(urls).toEqual([]);
  });
});
