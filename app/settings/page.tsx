import Settings from "@/views/Settings";
import { requireSession } from "@app/_lib/session";
import { getServerTrpc } from "@server/_core/serverTrpc";

/**
 * Route segment for /Settings.
 *
 * A Server Component. The screen's only read is the officer's own identity,
 * which the guard has already prefetched — a settings page that only ever shows
 * you yourself is the one screen where there was never a real fetch to save.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  const { trpc: trpcServer, HydrateClient } = await getServerTrpc();

  await requireSession(trpcServer, "/settings");

  return (
    <HydrateClient>
      <Settings />
    </HydrateClient>
  );
}
