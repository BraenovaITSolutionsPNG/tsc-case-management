import type { User } from "../../drizzle/schema";
import { createServerClient } from "./supabaseAuth";

/**
 * The identity attached to a request, and the shape `auth.me` returns.
 *
 * Two things are worth noting about what is *not* here:
 *
 *  - No `passwordHash`. The field is gone from the database schema entirely:
 *    Supabase holds the credential and never discloses it. The omission is now
 *    structural rather than a rule someone has to remember, which is why the
 *    type is declared as an omit of a schema row that no longer has the column.
 *  - No session token, no refresh token. This process never signs, verifies or
 *    stores a credential; it asks Supabase who is calling and gets back a user.
 *
 * `authUserId` is the Supabase `auth.users.id`, kept alongside the row's own
 * numeric `id` because the case register refers to officers by `id` and those
 * references must not move. The Supabase uuid is the link between the two
 * systems.
 */
export type AuthenticatedUser = Omit<User, "passwordHash"> & {
  authUserId: string;
};

/**
 * Resolves the caller from the Supabase session cookie on this request.
 *
 * The order of the three checks below is the whole of the authorization story
 * for a request, and it is deliberately the other way round from a naive
 * implementation:
 *
 *  1. No session is not an error. Public procedures must work for an anonymous
 *     visitor, so `null` is a valid answer and the caller decides.
 *  2. A session with no local user row is refused. Under the previous
 *     arrangement an unknown session was auto-provisioned from the identity
 *     provider, which meant anyone who could present a token became a row in
 *     the register. Accounts are created by an administrator now, so a session
 *     with no row is a session for somebody who was never set up.
 *  3. `isActive` is checked here, and not in a guard. A deactivated officer may
 *     hold a perfectly valid, unexpired session; the account has to be refused
 *     on every request, and the one place that cannot be forgotten is the one
 *     that builds the identity.
 *
 * `getUser` revalidates against Supabase on every call rather than trusting the
 * cookie's contents, which is what makes deleting or disabling an account take
 * effect immediately instead of at token expiry. It also means a refreshed
 * access token is written back through the cookie adapter as a side effect, so
 * the session survives without this app handling a token.
 */
export async function authenticateSupabaseRequest(): Promise<AuthenticatedUser | null> {
  const { getUserByAuthUserId, touchLastSignedIn } = await import("../db");

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;

  const user = await getUserByAuthUserId(data.user.id);

  if (!user) {
    // Accounts are provisioned by an administrator from the admin screen. A
    // valid Supabase session with no matching row is not an invitation to
    // create one.
    throw new Error(
      "This account has not been set up for the case management platform. Contact an administrator."
    );
  }

  if (!user.isActive) {
    throw new Error(
      "This account has been deactivated. Contact an administrator."
    );
  }

  await touchLastSignedIn(user.id, new Date());

  return { ...user, authUserId: data.user.id } as AuthenticatedUser;
}
