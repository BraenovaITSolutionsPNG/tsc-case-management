import CaseDetail from "@/views/CaseDetail";
import { requireSession } from "@app/_lib/session";
import { getServerTrpc } from "@server/_core/serverTrpc";

/**
 * Route segment for a single matter, `/cases/[id]`.
 *
 * A Server Component: the matter file, the referral history and the Director's
 * brief are three rounds of waiting before anything is worth reading, and all
 * three come back in the one payload now.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  // A promise in this Next.js version; the segment awaits it before it can know
  // which matter was asked for.
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  const { trpc: trpcServer, HydrateClient } = await getServerTrpc();
  const path = `/cases/${rawId}`;

  await requireSession(trpcServer, path);

  // The same validity test the screen applies before it will fire its own query,
  // so the two never disagree about whether this id is worth a request. A
  // segment reached with a junk id still renders the screen, which is what puts
  // its "that is not a matter" state on screen instead of a server error page.
  const id = Number(rawId);
  if (Number.isInteger(id) && id > 0) {
    await trpcServer.caseManagement.getById.prefetch({ id });
  }

  return (
    <HydrateClient>
      <CaseDetail />
    </HydrateClient>
  );
}
