import Admin from "@/views/Admin";
import { requireSession } from "@app/_lib/session";
import { getServerTrpc } from "@server/_core/serverTrpc";
import { can } from "@shared/access";
import { AUDIT_PAGE_SIZE } from "@shared/pagination";

/**
 * Route segment for /Admin.
 *
 * A Server Component. The user list is what the oversight screen opens on, and
 * it is the one query in this app that an officer without the role must never
 * reach the server for.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  const { trpc: trpcServer, HydrateClient } = await getServerTrpc();
  const user = await requireSession(trpcServer);

  // Prefetch the first tab this role can actually open, which is the one the
  // screen will render by default. The tab list is built from the same
  // capabilities the routes enforce, so the two agree on who sees what.
  //
  // Only that tab is prefetched — the tab strip unmounts the panels it is not
  // showing, so the other three do not mount their queries until they are opened.
  // Prefetching a tab the role cannot open would cache a refusal and then spend
  // a render throwing it, which is why the check is here rather than in the view.
  if (can(user.role, "platform:users")) {
    await trpcServer.admin.users.list.prefetch();
  } else if (can(user.role, "platform:oversight")) {
    await trpcServer.admin.provinces.prefetch();
    await trpcServer.admin.cases.list.prefetch();
    // The reassignment picker on every row of that list. Left out, the table
    // beside it arrived warm while its own controls stayed empty until a
    // request came back — which reads as the province having no officers.
    await trpcServer.admin.officers.prefetch();
  } else if (can(user.role, "platform:audit")) {
    await trpcServer.admin.audit.eventTypes.prefetch();
    // The rows as well. Only the filter list was being prefetched, so the tab
    // opened with a warm dropdown over a cold table — the one screen where the
    // loading was unavoidable was the one that had not been asked for.
    await trpcServer.admin.audit.list.prefetch({
      search: undefined,
      eventType: undefined,
      limit: AUDIT_PAGE_SIZE,
      offset: 0,
    });
  } else if (can(user.role, "platform:stats")) {
    await trpcServer.admin.stats.prefetch();
  }

  return (
    <HydrateClient>
      <Admin />
    </HydrateClient>
  );
}
