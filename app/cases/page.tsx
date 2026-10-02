import CaseRegister from "@/views/CaseRegister";
import { requireSession } from "@app/_lib/session";
import { getServerTrpc } from "@server/_core/serverTrpc";
import { REGISTER_PAGE_SIZE } from "@shared/pagination";

/**
 * Route segment for /CaseRegister.
 *
 * A Server Component, for the reason `app/page.tsx` sets out: the register is
 * the screen officers spend the day in, and it was the one paying the full cost
 * of a client-side fetch before a single row appeared.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function Page() {
  const { trpc: trpcServer, HydrateClient } = await getServerTrpc();

  await requireSession(trpcServer);

  // The first page, prefetched with exactly the input the screen will ask for, so
  // the dehydrated entry is the one it reads rather than a near miss it has to
  // fetch over. The screen starts with no filter applied and a page of one, which
  // is `{}` plus the paging terms.
  //
  // The province-wide figures are a second procedure, prefetched for the same
  // reason: they used to be a second read of the whole register, counted in the
  // browser, and they are now one aggregate the server answers separately. Both
  // are needed for the screen to be complete on arrival, and the register's cost
  // now depends on the page size rather than on how many matters the province
  // has accumulated.
  await trpcServer.caseManagement.list.prefetch({
    limit: REGISTER_PAGE_SIZE,
    offset: 0,
  });
  await trpcServer.caseManagement.summary.prefetch();

  return (
    <HydrateClient>
      <CaseRegister />
    </HydrateClient>
  );
}
