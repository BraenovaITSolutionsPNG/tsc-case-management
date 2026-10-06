import Reports from "@/views/Reports";
import { requireSession } from "@app/_lib/session";
import { getServerTrpc } from "@server/_core/serverTrpc";
import { can } from "@shared/access";

/**
 * Route segment for /Reports.
 *
 * A Server Component. The reporting set is the most expensive screen in the
 * office — each tab aggregates the whole register — so it is the one that gains
 * most from arriving complete.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  const { trpc: trpcServer, HydrateClient } = await getServerTrpc();
  const user = await requireSession(trpcServer);

  // Only the weekly brief is prefetched, because only the weekly brief is on
  // screen: the tab strip is a Radix `Tabs`, which unmounts the panels it is not
  // showing, so the other four reports do not mount their queries on arrival
  // either. They fetch when the officer switches to them, as they always did.
  //
  // `reports.quarters` is the exception, and it is not one of the five reports.
  // It is the list the Quarterly tab's picker is built from, and the quarterly
  // report itself is not requested until the picker has an answer to send — so
  // without this, opening Quarterly always arrived at an empty dropdown and a
  // two-step fetch. The list is small and every tab benefits from it being
  // present.
  //
  // The capability check is the same `can` call the screen makes to decide
  // whether to show the refusal panel. Reusing it here means an officer without
  // the capability is not made to pay for an aggregation they will never see.
  if (can(user.role, "report:view")) {
    await trpcServer.reports.weeklyBrief.prefetch();
    await trpcServer.reports.quarters.prefetch();
  }

  return (
    <HydrateClient>
      <Reports />
    </HydrateClient>
  );
}
