/**
 * The adapter between comical-bridge-kit's response guards and Comical's error vocabulary.
 *
 * The kit knows web infrastructure (anti-bot vendors, domain moves) and returns plain verdicts;
 * Comical knows only its contract errors. This is the one place the two meet:
 * - an anti-bot check becomes a `challengeMessage`, which the app answers with a web check (the
 *   person passes it in a web view with the request's own User-Agent, and the cookies it leaves
 *   join the bridge's jar);
 * - a flat block becomes a `rateLimitedMessage` the host backs off on;
 * - a domain move becomes a plain error that says so.
 *
 * Comical's network layer already turns a standard Cloudflare challenge (its `cf-mitigated`
 * header) into a challenge before a bridge sees the response; the guards catch the rest by the
 * page itself (DDoS-Guard, a Cloudflare page without the header).
 */
import { challengeMessage, type HttpRequest, type HttpResponse, rateLimitedMessage } from "@comical/sdk";
import { checkResponse, type Guard, type Verdict } from "comical-bridge-kit";

/** The page a web check opens for `req`: itself for a GET, the site's root otherwise (a web view only loads with GET). */
function checkPage(req: HttpRequest | undefined, res: HttpResponse): string {
  const url = res.url || req?.url || "";
  if (!req || (req.method ?? "GET").toUpperCase() === "GET") return url;
  try {
    return `${new URL(url).origin}/`;
  } catch {
    return url;
  }
}

function userAgentOf(req: HttpRequest | undefined): string | undefined {
  const key = Object.keys(req?.headers ?? {}).find((k) => k.toLowerCase() === "user-agent");
  return key ? req!.headers![key] : undefined;
}

/** The error message a verdict becomes. `req` is the request that drew it, when known. */
export function verdictMessage(v: Verdict, res?: HttpResponse, req?: HttpRequest): string {
  switch (v.kind) {
    case "challenge": {
      if (!res) return rateLimitedMessage(v.retryMs, v.reason);
      const userAgent = userAgentOf(req);
      return challengeMessage({ url: checkPage(req, res), ...(userAgent ? { userAgent } : {}), reason: v.reason });
    }
    case "blocked":
      return rateLimitedMessage(v.retryMs, v.reason);
    case "moved":
      return `${v.reason}. Try another domain in this source's settings, or update the bridge.`;
  }
}

/** Throw if any guard refuses `res` (drawn by `req`); otherwise hand it back untouched. */
export function guardResponse(res: HttpResponse, guards: readonly Guard[], req?: HttpRequest): HttpResponse {
  const verdict = checkResponse(res, guards);
  if (verdict) throw new Error(verdictMessage(verdict, res, req));
  return res;
}
