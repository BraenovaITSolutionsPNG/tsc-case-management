import { redirect } from "next/navigation";
import type { getServerTrpc } from "@server/_core/serverTrpc";

/**
 * Server-side session guard for the route segments.
 *
 * Prefetching turns the signed-out case from "the client notices a 401 and
 * navigates" into "the server never renders the screen at all", which is the
 * point of doing it on this side. It also means a protected procedure can no
 * longer throw `UNAUTHORIZED` out of a prefetch and take the segment down as a
 * render error, because the guard has established there is a session before any
 * prefetch runs.
 */

/**
 * The caller half of `getServerTrpc`, taken from the factory rather than
 * restated as a structural type. It has to be the real type: the guard hands the
 * officer straight back to the segment, and a segment gates its prefetches on
 * that role, so a widened stand-in here would quietly stop type-checking the
 * one field the caller depends on. The import is type-only, so this file does not
 * pull the caller factory into anything but the compiler.
 */
export type ServerTrpc = Awaited<ReturnType<typeof getServerTrpc>>["trpc"];

/** The identity `auth.me` returns — the signed-in officer, or nobody. */
export type Session = NonNullable<
  Awaited<ReturnType<ServerTrpc["auth"]["me"]>>
>;

/**
 * Resolves the signed-in officer, or sends them to the sign-in page.
 *
 * Takes the caller rather than building one so a segment asks for its helpers
 * once and shares them between the guard and its prefetches — two callers over
 * one cache would work, but a segment should not have to know that.
 *
 * A signed-out officer is sent to the sign-in page with nothing said about where
 * they were, and lands on the overview afterwards. That is a decision, and it is
 * the opposite of what this file used to do: it carried the path being asked for
 * through the query string so an officer interrupted mid-matter came back to that
 * matter.
 *
 * Every sign-in now lands on the overview, always. A matter is reached from the
 * register rather than restored from a URL, which is one fewer thing to reason
 * about after an expiry — and an expiry is exactly when a stale `next` is most
 * likely to be wrong, pointing at a matter that has since been closed or one the
 * officer has since lost the capability to open. The overview is the one page
 * every role can reach.
 *
 * The two calls that follow are deliberate. The direct call is the guard: it is
 * `ctx.user`, resolved once by `createContext`, so it cannot fail and costs no
 * database round trip. The prefetch is separate because it is what puts the
 * identity in the dehydrated cache, and the identity is read by six different
 * screens through `trpc.auth.me.useQuery()` — every one of them would otherwise
 * refetch it on mount even though the server was just handed it.
 */
export async function requireSession(trpcServer: ServerTrpc): Promise<Session> {
  const user = await trpcServer.auth.me();

  if (!user) {
    redirect("/login");
  }

  await trpcServer.auth.me.prefetch();

  return user;
}
