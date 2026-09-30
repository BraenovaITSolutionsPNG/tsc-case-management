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
