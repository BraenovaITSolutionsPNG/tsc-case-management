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
 * The order of the checks below is the whole of the authorization story for a
 * request:
 *
 *  1. No session is not an error. Public procedures must work for an anonymous
 *     visitor, so `null` is a valid answer and the caller decides.
 *  2. A session with no register row creates one, locked. Supabase owns sign-up,
 *     so an unknown identity is not an anomaly to refuse but a person who signed
 *     up. The row it writes carries `pendingApproval`, and step 3 refuses it, so
 *     the register stays closed to strangers — while an administrator gets a
 *     queue to approve rather than a stream of people who cannot get in.
 *  3. `pendingApproval` is checked before `isActive`, because it is the more
 *     specific answer: "not approved yet" and "access withdrawn" send somebody
 *     to their administrator for opposite reasons.
 *  4. `isActive` is checked here, and not in a guard. A deactivated officer may
 *     hold a perfectly valid, unexpired session; the account has to be refused
 *     on every request, and the one place that cannot be forgotten is the one
 *     that builds the identity.
 *
 * Every refusal throws rather than returning null, so it surfaces to the officer
 * as a message on the screen they are already looking at.
 *
 * `getUser` revalidates against Supabase on every call rather than trusting the
 * cookie's contents, which is what makes deleting or disabling an account take
 * effect immediately instead of at token expiry. It also means a refreshed
 * access token is written back through the cookie adapter as a side effect, so
 * the session survives without this app handling a token.
 */
export async function authenticateSupabaseRequest(): Promise<AuthenticatedUser | null> {
  const { getUserByAuthUserId, createPendingUser, touchLastSignedIn } =
    await import("../db");

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) return null;

  const user = await getUserByAuthUserId(data.user.id);

  // First sign-in. The identity is new, so there is no row, and one is created
  // locked rather than refused outright.
  //
  // This is the arrangement where Supabase owns sign-in completely: accounts
  // appear because somebody signed up, and no service-role key is needed to
  // record them — an INSERT on the application's own connection, which is what
  // lets the deployment stop holding a key that bypasses RLS.
  //
  // It does not open the register. The row created carries `pendingApproval`,
  // the refusal below fires on it, and until an administrator clears that flag
  // the account reaches nothing at all. What changes from the previous
  // arrangement is only what the refusal is *about*: before, a session with no
  // row was somebody who had not been set up and could not self-recover; now it
  // is an account awaiting approval, and the queue of them is what an
  // administrator works through.
  if (!user) {
    await createPendingUser({
      authUserId: data.user.id,
      email: data.user.email ?? null,
      // `full_name` is what the app itself puts in user_metadata; the fallbacks
      // are what a Supabase-hosted sign-up form produces.
      name:
        (data.user.user_metadata?.full_name as string | undefined) ??
        (data.user.user_metadata?.name as string | undefined) ??
        null,
    });
    throw new Error(
      "Your account is awaiting approval. An administrator has to approve it before you can use the case register."
    );
  }

  // Checked before `isActive` because it is the more specific answer, and an
  // account that is both pending and deactivated is one an administrator
  // deactivated while it was still in the queue.
  if (user.pendingApproval) {
    throw new Error(
      "Your account is awaiting approval. An administrator has to approve it before you can use the case register."
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
