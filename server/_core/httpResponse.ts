import { applyCookies } from "./http";
import type { AuthResult } from "./oauthHandlers";

/**
 * Turns the framework-agnostic `{ status, body, cookies, redirectTo }` that the
 * auth handlers return into a real `Response`.
 *
 * Both the local sign-in routes and the OAuth routes land here, so cookie
 * serialisation and the redirect convention are decided in exactly one place.
 * It lives under `server/` rather than beside the route handlers so it can
 * never be pulled into a client bundle by an accidental import.
 */
export function toAuthResponse(result: AuthResult): Response {
  const headers = new Headers({ "content-type": "application/json" });

  if (result.cookies?.length) {
    applyCookies(headers, result.cookies);
  }

  if (result.redirectTo) {
    headers.set("location", result.redirectTo);
    // A redirect has no meaningful body; returning one only invites a client to
    // parse it as a failed sign-in.
    return new Response(null, { status: 302, headers });
  }

  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers,
  });
}

/** The uniform error shape every auth route answers with. */
export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Parses a JSON request body without letting a malformed one throw. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * The client address to rate-limit against.
 *
 * Next.js populates `x-forwarded-for`; the first entry is the original caller
 * when every proxy in the chain appends honestly.
 */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || "unknown";
}
