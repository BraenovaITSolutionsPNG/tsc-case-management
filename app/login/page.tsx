import Login from "@/views/Login";
import { getServerTrpc } from "@server/_core/serverTrpc";
import { redirect } from "next/navigation";
import { LANDING_PATH } from "@shared/landing";

export const dynamic = "force-dynamic";

/**
 * Route segment for /login.
 *
 * The screen itself is a client component: it reads through the tRPC query
 * hooks, so it needs the providers mounted in the root layout. App Router owns
 * the URL; this file is the segment that binds the two together — and decides,
 * on the server, whether this visitor is allowed to see the form at all.
 *
 * That decision used to be made in the browser, and it cost a visible frame.
 * The screen asked `auth.me` whether there was a session and redirected if so,
 * which meant the sign-in form was painted first and then taken away — so an
 * officer who was already signed in and opened `/login` (by typing the URL, by
 * the back button, or by following a stale link) watched a full-screen loader
 * arrive over a form they did not need. The alternative to that flash was the
 * arrangement this file exists to avoid: holding the *whole* form behind a
 * loader until the probe answered, which is what every ordinary visitor paid,
 * including the overwhelming majority who have no session and could not be
 * affected either way.
 *
 * Reading the cookie on the server removes the choice. The session is an
 * httpOnly cookie, which is unreadable from a client component and perfectly
 * readable from here, so the redirect happens before any HTML is sent and there
 * is nothing to flash. The client-side check in `Login` is kept as a fallback
 * for the session changing under an already-open page, and by then it has
 * almost nothing left to do.
 *
 * `force-dynamic` because of that cookie: a statically prerendered sign-in
 * form would serve the same markup to a signed-in officer and an anonymous one,
 * which is the exact mistake the server guard exists to prevent.
 */
export default async function Page() {
  const { trpc: trpcServer, HydrateClient } = await getServerTrpc();

  // `auth.me` reads `ctx.user`, which the context resolved once when it was
  // built, so this is not an extra verification — it is a read of an answer
  // this request already has. The decorated procedure is a server-side caller,
  // so it is called directly rather than through a hook.
  const user = await trpcServer.auth.me();

  if (user) redirect(LANDING_PATH);

  /*
   * Both prefetched into the cache that travels out with the HTML, so the form
   * paints with the answers already in hand and the client fires no request to
   * ask whether there is a session — including the second query behind the
   * refusal screen.
   *
   * `auth.me` is prefetched even though its value was just read above, because
   * `query()` returns a value and `prefetch()` is what writes it into the cache
   * the client hydrates from. Without it the client's own `useAuth` would refetch
   * on mount, which is the request this segment exists to avoid.
   */
  await Promise.all([
    trpcServer.auth.me.prefetch(),
    trpcServer.auth.refusal.prefetch(),
  ]);

  return (
    <HydrateClient>
      <Login />
    </HydrateClient>
  );
}
