import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@server/routers";
import { createContext } from "@server/_core/context";
import type { TrpcContextWithCookies } from "@server/_core/context";
import { applyCookies, toTrpcRequest } from "@server/_core/http";

/**
 * The whole tRPC surface, served by Next.js instead of the Express app that
 * used to own it.
 *
 * The context is captured in a closure rather than left to the adapter, because
 * `auth.logout` clears the session cookie as a side effect of a procedure: the
 * router writes that cookie onto the context, and the only way to put it on the
 * wire is to read the context back after the handler has produced a response.
 */

export const runtime = "nodejs";

// Drizzle, MySQL and node:crypto all need the Node runtime, and every
// procedure reads or writes per-user data, so nothing here is cacheable.
export const dynamic = "force-dynamic";

async function handler(request: Request): Promise<Response> {
  // Held in an object rather than a plain `let` because the assignment happens
  // inside a callback: flow analysis would otherwise narrow the local back to
  // `null` at the read below and type it `never`.
  const captured: { context: TrpcContextWithCookies | null } = { context: null };

  const response = await fetchRequestHandler({
    endpoint: "/api/trpc",
    req: request,
    router: appRouter,
    createContext: async () => {
      captured.context = await createContext(toTrpcRequest(request));
      return captured.context;
    },
    onError({ error, path }) {
      if (error.code === "INTERNAL_SERVER_ERROR") {
        console.error(`[trpc] ${path ?? "<no path>"} failed:`, error);
      }
    },
  });

  // Headers from the adapter are copied onto a mutable clone: the `Response`
  // it returns may be immutable, and the logout cookie has to be added after
  // the fact.
  const headers = new Headers(response.headers);
  if (captured.context) {
    applyCookies(headers, captured.context.cookies);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export { handler as GET, handler as POST };
