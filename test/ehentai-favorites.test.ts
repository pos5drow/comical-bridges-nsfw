/**
 * Unit tests for the e-hentai auth/favorites pure helpers. The end-to-end flow needs a live account
 * with pasted cookies (see test-favorites-ehentai.ts); these cover the parsing the flow depends on.
 */
import { describe, expect, test } from "bun:test";
import { isFavoritedFromPopup, isLoggedOut, parseCookieString } from "../src/ehentai.ts";

describe("parseCookieString", () => {
  test("parses a tidy 'name=value; …' string", () => {
    const map = parseCookieString("ipb_member_id=12345; ipb_pass_hash=deadbeef; igneous=abc123");
    expect(map).toEqual({ ipb_member_id: "12345", ipb_pass_hash: "deadbeef", igneous: "abc123" });
  });

  test("extracts the needed cookies from a full document.cookie dump", () => {
    const blob =
      "yay=louder; ipb_member_id=12345; sl=p; ipb_pass_hash=deadbeef; sk=xyz; nw=1; igneous=abc123";
    const map = parseCookieString(blob);
    expect(map.ipb_member_id).toBe("12345");
    expect(map.ipb_pass_hash).toBe("deadbeef");
    expect(map.igneous).toBe("abc123");
  });

  test("tolerates newline separators and stray whitespace", () => {
    const map = parseCookieString("  ipb_member_id = 12345 \n ipb_pass_hash=deadbeef \n");
    expect(map).toEqual({ ipb_member_id: "12345", ipb_pass_hash: "deadbeef" });
  });

  test("empty / blank input → empty map", () => {
    expect(parseCookieString("")).toEqual({});
    expect(parseCookieString("   ")).toEqual({});
  });
});

describe("isLoggedOut", () => {
  test("true on the gate message", () => {
    expect(isLoggedOut("<p>This page requires you to log on.</p>")).toBe(true);
  });

  test("true when the IPB login form is present", () => {
    expect(isLoggedOut('<input type="text" name="UserName" />')).toBe(true);
  });

  test("false for a normal logged-in favorites page", () => {
    expect(isLoggedOut('<a href="/g/123/abc/">A gallery</a>')).toBe(false);
  });
});

describe("isFavoritedFromPopup", () => {
  test("true when a slot radio (0–9) is checked", () => {
    const html = '<input type="radio" name="favcat" value="3" checked="checked" />';
    expect(isFavoritedFromPopup(html)).toBe(true);
  });

  test("attribute order is irrelevant", () => {
    const html = '<input checked value="0" name="favcat" type="radio" />';
    expect(isFavoritedFromPopup(html)).toBe(true);
  });

  test("false when only favdel is checked (not favorited)", () => {
    const html =
      '<input type="radio" name="favcat" value="favdel" checked />' +
      '<input type="radio" name="favcat" value="0" />';
    expect(isFavoritedFromPopup(html)).toBe(false);
  });
});
