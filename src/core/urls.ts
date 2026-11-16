/**
 * URL helpers that behave the same in every engine a bridge runs in. On a phone, bridges run in
 * JavaScriptCore or QuickJS, whose `URL` stand-ins only take an absolute URL (no base argument) and
 * don't update `href` when `searchParams` change; `new URL(path, base)` throws there, and a changed
 * query is silently lost. These use only strings and `URLSearchParams`, which every engine has.
 */

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:/i;
const PARTS = /^([a-z][a-z0-9+.-]*:)\/\/([^/?#]*)([^?#]*)(\?[^#]*)?(#.*)?$/i;

/** `ref` resolved against `base` (an absolute http(s) URL), or undefined when it can't be. */
export function absoluteUrl(ref: string, base: string): string | undefined {
  const r = ref.trim();
  if (!r) return undefined;
  if (ABSOLUTE.test(r)) return r;
  const b = PARTS.exec(base.trim());
  if (!b) return undefined;
  const [, protocol, host, path = "", search = ""] = b;
  const origin = `${protocol}//${host}`;
  if (r.startsWith("//")) return `${protocol}${r}`;
  if (r.startsWith("#")) return `${origin}${path || "/"}${search}${r}`;
  if (r.startsWith("?")) return `${origin}${path || "/"}${r}`;
  const [pathPart, rest = ""] = splitPath(r);
  const dir = r.startsWith("/") ? "" : (path || "/").replace(/[^/]*$/, "");
  return `${origin}${normalize(`${dir}${pathPart}`)}${rest}`;
}

/** The URL's host name, lower-cased, or undefined for anything that isn't an absolute URL. */
export function hostOf(url: string): string | undefined {
  return PARTS.exec(url.trim())?.[2]?.replace(/^[^@]*@/, "").replace(/:\d+$/, "").toLowerCase() || undefined;
}

/** The URL's path ("/" when it has none), or undefined for anything that isn't an absolute URL. */
export function pathOf(url: string): string | undefined {
  const m = PARTS.exec(url.trim());
  return m ? m[3] || "/" : undefined;
}

/** A query parameter's value, or null. */
export function queryParam(url: string, name: string): string | null {
  const search = PARTS.exec(url.trim())?.[4] ?? "";
  return new URLSearchParams(search).get(name);
}

/** `url` with query parameters set (a string) or removed (null), keeping the rest as it was. */
export function withQuery(url: string, changes: Record<string, string | null>): string {
  const hashAt = url.indexOf("#");
  const hash = hashAt >= 0 ? url.slice(hashAt) : "";
  const noHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const qAt = noHash.indexOf("?");
  const head = qAt >= 0 ? noHash.slice(0, qAt) : noHash;
  const params = new URLSearchParams(qAt >= 0 ? noHash.slice(qAt + 1) : "");
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) params.delete(name);
    else params.set(name, value);
  }
  const qs = params.toString();
  return `${head}${qs ? `?${qs}` : ""}${hash}`;
}

function splitPath(ref: string): [string, string] {
  const at = ref.search(/[?#]/);
  return at >= 0 ? [ref.slice(0, at), ref.slice(at)] : [ref, ""];
}

/** A path with `.` and `..` segments resolved. */
function normalize(path: string): string {
  const out: string[] = [];
  const segments = path.split("/");
  for (const [i, s] of segments.entries()) {
    if (s === "..") {
      if (out.length > 1) out.pop();
    } else if (s !== "." || i === segments.length - 1) {
      out.push(s === "." ? "" : s);
    }
  }
  const joined = out.join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}
