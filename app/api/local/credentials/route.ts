import { handleSetCredential } from "@server/_core/localAuthHandlers";
import { jsonError, readJsonBody, toAuthResponse } from "@server/_core/httpResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Set a local credential on an account. Development only, and deliberately
 * open: it exists so a demonstrator can create a login for any role without
 * database access. It is unreachable in production.
 */
export async function POST(request: Request): Promise<Response> {
  const body = await readJsonBody(request);

  try {
    return toAuthResponse(await handleSetCredential(body));
  } catch (error) {
    console.error("[LocalAuth] Credential setup failed unexpectedly", error);
    return jsonError("Could not set the credential.", 500);
  }
}
