import type { CookieMutation, TrpcRequest } from "./context";
import { serializeCookie } from "./cookies";

/**
 * Adapters between the Web Fetch API that Next.js route handlers speak and the
 * structural request/response shape the tRPC context is built on.
 *
 * Both directions live here rather than in the route handlers so the same code
 * backs the HTTP endpoint and the unit tests, and so there is exactly one place
 * that knows how a cookie mutation becomes a header.
 */

/** Normalises a Fetch `Request` into the plain header record the context wants. */
export function toTrpcRequest(request: Request): TrpcRequest {
  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // Repeated `cookie` headers are folded into one comma-joined value by
  // `Headers.forEach` above, which the cookie parser cannot read — it expects
  // pairs separated with "; ". The Fetch API's own answer is `getSetCookie`, but
  // that returns `Set-Cookie` values, which a *request* never carries, so it is
  // always empty here and cannot unfold anything. Next.js supplies a single
  // `cookie` header already joined with "; ", so the line above is correct as it
  // stands; this comment previously claimed the block below fixed the folding
  // and it never did. A runtime that did fold it would need the pairs re-joined
  // here, and `supabaseSessionCookieNames` would then miss a chunked session
  // cookie — the failure that function's regex exists to prevent.

  // Node does not populate `protocol`; trust the proxy header when present and
  // otherwise assume the connection Next terminated is plain HTTP locally.
  const forwarded = request.headers.get("x-forwarded-proto");
  const protocol = forwarded?.split(",")[0]?.trim() ?? "http";

  return { protocol, headers };
}

/**
 * Replays the cookie writes a procedure made onto an outgoing response.
 *
 * `Set-Cookie` cannot be folded into a single comma-joined value, because
 * `Expires=Wed, 01 Jan 2025 ...` itself contains a comma and browsers split on
 * the wrong one. Undici's `Headers` keeps repeated `set-cookie` entries
 * separate, so appending once per mutation is both necessary and sufficient.
 */
export function applyCookies(
  headers: Headers,
  mutations: readonly CookieMutation[]
): void {
  for (const mutation of mutations) {
    headers.append(
      "set-cookie",
      serializeCookie(mutation.name, mutation.value, mutation.options)
    );
  }
}
