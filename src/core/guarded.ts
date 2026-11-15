/**
 * The adapter between comical-bridge-kit's response guards and Comical's error vocabulary.
 *
 * The kit knows web infrastructure (anti-bot vendors, domain moves) and returns plain verdicts;
 * Comical knows only its contract errors. This is the one place the two meet: a refused response
 * becomes a `rateLimitedMessage` the host backs off on, or a plain error that says the site moved.
 */
import { type HttpResponse, rateLimitedMessage } from "@comical/sdk";
import { checkResponse, type Guard, type Verdict } from "comical-bridge-kit";

/** The error message a verdict becomes. */
export function verdictMessage(v: Verdict): string {
  switch (v.kind) {
    case "challenge":
    case "blocked":
      return rateLimitedMessage(v.retryMs, v.reason);
    case "moved":
      return `${v.reason}. Try another domain in this source's settings, or update the bridge.`;
  }
}

/** Throw if any guard refuses `res`; otherwise hand it back untouched. */
export function guardResponse(res: HttpResponse, guards: readonly Guard[]): HttpResponse {
  const verdict = checkResponse(res, guards);
  if (verdict) throw new Error(verdictMessage(verdict));
  return res;
}
