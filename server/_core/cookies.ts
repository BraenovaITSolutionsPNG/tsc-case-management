import type { TrpcRequest } from "./context";

/**
 * Cookie attributes for the session cookie, in the shape Next.js `cookies()`
 * and the `Set-Cookie` serialiser both accept.
 *
 * The `domain` branch is deliberately not computed. Deriving a parent domain
 * from the request host was the old behaviour, and it is wrong for this
 * deployment: a host-only cookie is what the OAuth portal and the app share,
 * and a computed `.domain` attribute is rejected outright by browsers when it
 * is not a registrable suffix of the origin.
 */
export type SessionCookieOptions = {
  domain?: string;
  httpOnly: boolean;
  path: string;
  sameSite: "none" | "lax" | "strict";
  secure: boolean;
};

function isSecureRequest(req: TrpcRequest) {
  // Set by the adapter from the Web `Request` when it is behind TLS directly.
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : [forwardedProto];

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: TrpcRequest
): SessionCookieOptions {
  // `SameSite=None` is only honoured by browsers when the cookie is also
  // `Secure`, so a plain-HTTP request must fall back to `Lax` or the browser
  // silently drops the session and every request looks logged out.
  const secure = isSecureRequest(req);

  return {
    httpOnly: true,
    path: "/",
    sameSite: secure ? "none" : "lax",
    secure,
  };
}

/**
 * Supabase's session cookie names, as they appear on a request.
 *
 * `sb-<project-ref>-auth-token`, and `sb-<project-ref>-auth-token.<n>` for each
 * chunk when the session is too large for one cookie — the browser sends what it
 * was given and the server deletes what it can see, so a sign-out that deletes
 * only the base name deletes a cookie that was never sent and leaves the session
 * resolving.
 *
 * Read off the request rather than computed from the project ref, because the
 * names are the library's business and they have changed before (the app's own
 * `app_session_id` is the scar from when it was ours). A cookie of this shape
 * that arrived on the request is a session cookie by definition, so deleting it
 * cannot remove something unrelated.
 */
const SUPABASE_SESSION_COOKIE = /^sb-.+-auth-token(?:\.\d+)?$/;

/** Every Supabase session cookie on this request, de-duplicated, in the order they were sent. */
export function supabaseSessionCookieNames(req: TrpcRequest): string[] {
  const header = req.headers.cookie;
  if (!header) return [];

  const sent = Array.isArray(header) ? header.join("; ") : header;
  const found = new Set<string>();

  for (const pair of sent.split(";")) {
    // Split on the first `=` only: the value is base64 and may itself contain
    // padding, and nothing here needs the value.
    const name = pair.split("=")[0]?.trim();
    if (name && SUPABASE_SESSION_COOKIE.test(name)) {
      found.add(name);
    }
  }

  return [...found];
}

/**
 * Serialises a cookie write into a `Set-Cookie` header value.
 *
 * Next.js route handlers cannot hand a cookie to an in-flight `Response` the
 * way `res.cookie()` could under Express, and `Headers.append` folds repeated
 * `Set-Cookie` values into one comma-joined string, which no browser parses
 * correctly for `Expires` (it contains a comma). The outgoing response therefore
 * carries a raw array, which the Web `Headers` implementation in Node
 * understands and sends as separate header lines.
 */
export function serializeCookie(
  name: string,
  value: string,
  options: Record<string, unknown>
): string {
  const parts = [`${name}=${value}`];

  if (typeof options.maxAge === "number") {
    // Express takes a millisecond maxAge and writes it back as Max-Age in
    // seconds. A negative value is a deletion, so keep the sign.
    parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  }
  if (typeof options.expires === "string" || options.expires instanceof Date) {
    parts.push(`Expires=${new Date(options.expires as string).toUTCString()}`);
  }
  parts.push(`Path=${options.path ?? "/"}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) {
    const mode = String(options.sameSite).toLowerCase();
    parts.push(`SameSite=${mode.charAt(0).toUpperCase()}${mode.slice(1)}`);
  }

  return parts.join("; ");
}
