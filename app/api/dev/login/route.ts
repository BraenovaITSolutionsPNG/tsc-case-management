import { handleDevLogin } from "@server/_core/oauthHandlers";
import { toAuthResponse } from "@server/_core/httpResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Development-only sign-in. Unreachable in production, where the handler
 * answers 404 before touching the database.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const result = await handleDevLogin(
    url.searchParams.get("next") ?? undefined,
    url.protocol === "https:"
  );

  return toAuthResponse(result);
}
