import { handleOAuthCallback } from "@server/_core/oauthHandlers";
import { toAuthResponse } from "@server/_core/httpResponse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Manus OAuth redirect target. Next.js owns the routing, so the Express
 * `res.redirect` this used to call becomes a 302 with a `Location` header,
 * built by the shared adapter in `@/lib/http`.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const result = await handleOAuthCallback(
    {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    },
    request.headers.get("cookie") ?? "",
    url.protocol === "https:"
  );

  return toAuthResponse(result);
}
