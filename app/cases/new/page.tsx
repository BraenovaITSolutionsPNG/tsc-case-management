import NewCase from "@/views/NewCase";
import { requireSession } from "@app/_lib/session";
import { getServerTrpc } from "@server/_core/serverTrpc";

/**
 * Route segment for /NewCase.
 *
 * A Server Component, but with nothing to prefetch: registering a matter reads
 * no case data, it only writes. The guard still runs here, which is the part
 * that matters — an officer who is not signed in is turned away before the form
 * is rendered rather than discovering it when they submit.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  const { trpc: trpcServer, HydrateClient } = await getServerTrpc();

  await requireSession(trpcServer, "/cases/new");

  return (
    <HydrateClient>
      <NewCase />
    </HydrateClient>
  );
}
