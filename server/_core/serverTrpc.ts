import { createHydrationHelpers } from "@trpc/react-query/rsc";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { makeQueryClient } from "@shared/queryClient";
import { appRouter, type AppRouter } from "@server/routers";
import { createContext, type TrpcRequest } from "@server/_core/context";

/**
 * Calling the app's own procedures from the server, without a network round trip.
 *
 * A route segment that knows which procedure its screen needs can ask for it
 * here, have the answer put in a cache, and let the dehydrated cache travel out
 * inside the page. The officer's browser then starts with the register already
 * drawn rather than with a skeleton and a spinner.
 *
 * This is not a second implementation of the API — it is the same `appRouter`
 * behind the same auth middleware and the same `superjson` transformer, so a
 * capability the procedure refuses on the server is refused here identically.
 */

/**
 * One cache per request, shared by every segment that renders in it.
 *
 * React's `cache` is scoped to a single render pass, which is what makes this
 * safe: two segments in the same request see the same cache and therefore the
 * same prefetches, while the next request gets a fresh one. A module-level
 * singleton would be wrong — it would serve one officer's matters to the next
 * officer's request, and would keep growing for the life of the process.
 */
const getQueryClient = cache(makeQueryClient);

/**
 * Rebuilds the incoming HTTP request from a Server Component's point of view.
 *
 * The tRPC context was written to be structural precisely so this is possible: it
 * wants a header record, and a Server Component has the request's headers
 * available through `next/headers` without it having to travel over the wire to
 * its own server.
 *
 * The cookie jar is re-serialised because `headers()` does not expose `cookie` as
 * a joined string, and `sdk.authenticateRequest` parses that string. Everything
 * else is passed through so the identity resolution sees what the browser sent —
 * notably the `Authorization` header, which is how the Preview shell's
 * sessionStorage fallback authenticates when cookies are blocked.
 */
async function serverTrpcRequest(): Promise<TrpcRequest> {
  const requestHeaders: Record<string, string | string[] | undefined> = {};
  const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);

  headerList.forEach((value, key) => {
    requestHeaders[key.toLowerCase()] = value;
  });

  const cookieHeader = cookieStore
    .getAll()
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join("; ");

  if (cookieHeader) {
    requestHeaders.cookie = cookieHeader;
  }

  // Next.js terminates TLS at its own edge and the proxy header is not always
  // preserved to a Server Component. The procedures that write cookies need a
  // protocol to decide `Secure` and `SameSite`, and a wrong answer there would
  // hand the browser a session cookie it silently drops. Reads are unaffected
  // either way, so this only has to be right, not merely present.
  if (!requestHeaders["x-forwarded-proto"]) {
    requestHeaders["x-forwarded-proto"] =
      process.env.NODE_ENV === "production" ? "https" : "http";
  }

  return {
    protocol: String(requestHeaders["x-forwarded-proto"]).split(",")[0].trim(),
    headers: requestHeaders,
  };
}

/**
 * The server-side tRPC entry point.
 *
 * `createHydrationHelpers` needs the caller synchronously — it reaches through
 * it to find the procedure before dispatching — while the context depends on an
 * awaited `cookies()`. The two are reconciled by returning the helpers from an
 * async factory instead of building them at module scope: the caller is bound to
 * the request that is rendering, and the cache behind it stays shared because
 * `getQueryClient` is the `cache()`-wrapped one.
 *
 * Call it once per segment and use both halves of what it returns:
 *
 * ```tsx
 * const { trpc: trpcServer, HydrateClient } = await getServerTrpc();
 * await trpcServer.caseManagement.dashboard.prefetch();
 * return <HydrateClient><Home /></HydrateClient>;
 * ```
 */
export async function getServerTrpc() {
  const context = await createContext(await serverTrpcRequest());
  const caller = appRouter.createCaller(context);

  return createHydrationHelpers<AppRouter>(caller, getQueryClient);
}

/**
 * The per-request cache, for the rare segment that needs to read it directly —
 * `getQueryClient().getQueryData(...)` or a `dehydrate()` of its own. Exposed
 * separately from `getServerTrpc` so a caller does not have to build a second
 * caller to reach it.
 */
export { getQueryClient };
