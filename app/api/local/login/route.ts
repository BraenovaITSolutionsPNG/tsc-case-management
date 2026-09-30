import { handleLogin } from "@server/_core/localAuthHandlers";
import {
  clientAddress,
  jsonError,
  readJsonBody,
  toAuthResponse,
} from "@server/_core/httpResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Username-and-password sign-in. Unreachable in production, where the handler
 * answers 404 before touching the database.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);
  const url = new URL(request.url);

  try {
    return toAuthResponse(
      await handleLogin(body, clientAddress(request), url.protocol === "https:")
    );
  } catch (error) {
    // Sign-in must fail closed and stay up: an unhandled rejection here would
    // take the whole server down over one bad request.
    console.error("[LocalAuth] Login failed unexpectedly", error);
    return jsonError("Sign in failed. Try again.", 500);
  }
}
