import Settings from "@/views/Settings";
import { requireSession } from "@app/_lib/session";
import { getServerTrpc } from "@server/_core/serverTrpc";

/**
 * Route segment for /Settings.
 *
 * A Server Component. The officer's identity comes from the guard, which
 * prefetches it.
 *
 * `auth.sessions` is prefetched too, and the note that used to stand here was
 * wrong: it said this screen only ever shows the officer themselves, which was
 * true of the identity panel and not of the "Where you're signed in" panel
 * below it. That one is a real read of the session service, it was not
 * prefetched, and so every arrival at Settings opened on a skeleton for the
 * lower half of the screen.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  const { trpc: trpcServer, HydrateClient } = await getServerTrpc();

  await requireSession(trpcServer);

  // The devices list the screen draws below the identity panels. Cheap, and the
  // reason the page arrives whole rather than half-formed.
  await trpcServer.auth.sessions.prefetch();

  return (
    <HydrateClient>
      <Settings />
    </HydrateClient>
  );
}
