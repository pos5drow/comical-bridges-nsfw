/**
 * The site refuses an over-eager client in two shapes that both arrive as a 200: an IP-ban notice
 * served in place of any page, and a quota placeholder in a viewer page's image slot. Both must
 * surface as a rate-limited error carrying the wait, so hosts hold the bridge instead of retrying
 * a ban into a longer one.
 */
import { describe, expect, test } from "bun:test";
import { parseRateLimited } from "@comical/sdk";
import { sourceRefusal } from "../src/ehentai.ts";

const wait = (e: Error | undefined) => (e ? parseRateLimited(e.message)?.retryAfterMs : undefined);
const H = 60 * 60 * 1000;

describe("sourceRefusal", () => {
  test("an IP ban carries the stated expiry", () => {
    const notice =
      "This IP address has been temporarily banned due to an excessive request rate. " +
      "This probably means you are using automated mirroring/harvesting software. " +
      "The ban expires in 2 hours and 34 minutes";
    expect(wait(sourceRefusal(notice))).toBe(2 * H + 34 * 60_000);
  });

  test("days and seconds count too", () => {
    const notice = "Your IP address has been temporarily banned. The ban expires in 1 day and 30 seconds.";
    expect(wait(sourceRefusal(notice))).toBe(24 * H + 30_000);
  });

  test("a ban with no readable expiry waits the default", () => {
    expect(wait(sourceRefusal("You have been temporarily banned."))).toBe(3 * H);
  });

  test("the quota placeholder in the image slot waits an hour", () => {
    expect(wait(sourceRefusal("<html>…</html>", "https://ehgt.org/g/509.gif"))).toBe(H);
    expect(wait(sourceRefusal("<html>…</html>", "https://exhentai.org/img/509s.gif"))).toBe(H);
  });

  test("an ordinary page or image is not a refusal", () => {
    expect(sourceRefusal("<html><body>gallery</body></html>", "https://abc.hath.network/h/x/1509.jpg")).toBeUndefined();
    expect(sourceRefusal("<html><body>gallery</body></html>")).toBeUndefined();
  });

  test("a full page that merely mentions a ban is not one", () => {
    const page = `<html><body>${"x".repeat(5000)}<div class="c6">I got temporarily banned lol</div></body></html>`;
    expect(sourceRefusal(page)).toBeUndefined();
  });
});
