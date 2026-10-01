import Home from "@/views/Home";
import { requireSession } from "@app/_lib/session";
import { getServerTrpc } from "@server/_core/serverTrpc";

/**
 * Route segment for /Home.
 *
 * A Server Component. It resolves the session, asks the server for the figures
 * the dashboard draws, and hands the answer to the screen as a dehydrated cache,
 * so `Home` mounts with its numbers already in the cache instead of rendering a
 * skeleton and then fetching. The screen itself stays a client component reading
 * through the same tRPC query hooks — this segment changes when the data is
 * fetched, not what the screen reads.
 *
 * `HydrateClient` is deliberately wrapped around the screen here rather than
 * placed once in the root layout. It works by serialising the cache at the moment
 * it renders, so a layout above the page would take that snapshot before the
 * page had finished filling the cache. Wrapping at the point of use makes the
 * ordering the only possible one.
 */

// Drizzle and the PostgreSQL driver need the Node runtime, and reading the session cookie makes
// the segment per-request, so there is no cacheable version of this page.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  const { trpc: trpcServer, HydrateClient } = await getServerTrpc();

  await requireSession(trpcServer, "/");
  await trpcServer.caseManagement.dashboard.prefetch();

  return (
    <HydrateClient>
      <Home />
    </HydrateClient>
  );
}
