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
 * access token is written back through the cookie adapter as a side effect, so the
 * session survives without this app handling a token.
 *
 * The session is resolved *before* the database is asked whether it is there, and
 * that ordering is the whole of the fourth case. A platform that cannot reach its
 * database has no opinion about anybody's account, and `getUserByAuthUserId`
 * answers `undefined` for a missing database and for a missing row alike — so
 * without the check an unreachable database presents as "this account has not
 * been set up", which sends the operator to create an account that already exists
 * while the officer is told the account is the problem. The two faults have
 * opposite fixes and neither symptom points at the right one.
 *
 * It also decides who the refusal is written for. The check used to come first,
 * which meant a deployment with no database refused *every* request — including
 * the anonymous ones — and so told an officer who had not yet signed in that their
 * password had been accepted. That sentence is only assertable about somebody who
 * presented a session, so the session is resolved before anything is claimed about
 * it: an anonymous visitor on a broken platform gets the form, and the officer
 * who has proved who they are gets the refusal, which is now true of every
 * refusal the sign-in screen can show.
 *
 * Cheaper as well as more honest. Anonymous traffic — every screen an
 * unauthenticated visitor loads — used to open a database connection and run
 * `SELECT version()` before it discovered there was nobody to identify. It now
 * costs one Supabase call and no database connection at all.
 */
export async function authenticateSupabaseRequest(): Promise<AuthenticatedUser | null> {
  const { getDb, getUserByAuthUserId, touchLastSignedIn } = await import(
    "../db"
  );

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();

  // First, because everything below this line is a statement about somebody who
  // presented a session, and "no session is not an error" is true whether or not
  // the database is there.
  if (error || !data.user) return null;

  if (!(await getDb())) {
    throw new Error(
      "The platform cannot reach its database, so your account could not be checked. Nothing is wrong with your account — try again shortly, and tell the platform administrator if it continues."
    );
  }

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
