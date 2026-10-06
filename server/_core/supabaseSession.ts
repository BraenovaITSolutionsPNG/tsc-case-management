import type { User } from "../../drizzle/schema";
import { createServerClient } from "./supabaseAuth";
import { isAuthRetryableFetchError } from "@supabase/auth-js";

/**
 * The identity attached to a request, and the shape `auth.me` returns.
 *
 * Two things are worth noting about what is *not* here:
 *
 *  - No `passwordHash`. The field is gone from the database schema entirely:
 *    Supabase holds the credential and never discloses it, so there is nothing
 *    to omit. This used to read `Omit<User, "passwordHash">`, which was a no-op
 *    from the moment the column was dropped — the type it named no longer had the
 *    key — and described an omission it was not performing. The note is kept
 *    because the omission it was guarding against is real if a credential column
 *    is ever added back, and `User` would then have to be projected instead of
 *    spread.
 *  - No session token, no refresh token. This process never signs, verifies or
 *    stores a credential; it asks Supabase who is calling and gets back a user.
 *
 * `authUserId` is the Supabase `auth.users.id`, kept alongside the row's own
 * numeric `id` because the case register refers to officers by `id` and those
 * references must not move. The Supabase uuid is the link between the two
 * systems.
 */
export type AuthenticatedUser = User & {
  authUserId: string;
  /**
   * The Supabase session this request came in on, or null if it could not be read.
   *
   * Needed to tell one signed-in device from another: the user id is identical on
   * all of them, so "everything except this one" has nothing to exclude without
   * it. Null is a real answer rather than an omission — a deployment whose tokens
   * carry no `session_id` still signs in, and the device list degrades to "all of
   * yours" rather than breaking.
   */
  sessionId: string | null;
};

/**
 * How far `lastSignedIn` may drift before it is written again.
 *
 * A sign-in timestamp is not a heartbeat and nothing reads it at a precision
 * finer than this, so resolving it to the minute costs nothing and buys a page
 * of parallel requests one write instead of one each.
 */
const LAST_SIGNED_IN_RESOLUTION_MS = 5 * 60_000;

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
 * The signature on the cookie is verified rather than trusted — see the
 * verification call below for why that is `getClaims` and not a decode, and for
 * the one thing it gives up. A refreshed access token is written back through the
 * cookie adapter as a side effect, so the session survives without this app
 * handling a token.
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

  // The token first, then the claim it carries — in that order, and the order
  // is the point rather than a detail.
  //
  // `getSession` reads the cookie this process already has rather than the
  // network, so it is free, and it is what tells us whether there is a token at
  // all. Returning here on its answer means an anonymous request costs one
  // cookie read and no verification of any kind — which is every screen an
  // unauthenticated visitor loads, including the sign-in form itself.
  //
  // Then `getClaims` rather than `getUser`, which is what this used to call.
  // Supabase's own guidance is to prefer it: `getUser` "always sends a request
  // to the Auth server for each JWT", whereas `getClaims` verifies the
  // signature against the project's JSON Web Key Set, which is fetched once and
  // cached, so the verification is local. It is not a decode — the signature is
  // checked with WebCrypto and `exp` is still enforced, since `allowExpired` is
  // never passed. This is the dominant remaining latency on a signed-in page
  // load: it ran once for the Server Component's render and again for every
  // batched client query, each one waiting on Supabase.
  //
  // It is never slower, which is what makes this safe to do without a flag. If
  // the project signs with a symmetric secret (HS256) rather than an asymmetric
  // key, `getClaims` cannot verify locally — it has no public key and this
  // application deliberately does not hold the secret — so it falls back to
  // asking Supabase, and the old behaviour is what happens anyway.
  //
  // What does change, and it is one thing: a *revoked* session. Revoking a
  // refresh token is a fact only Supabase's database knows, and a locally
  // verified signature cannot know it, so an access token that has been revoked
  // keeps verifying until it expires. What that does and does not affect:
  //
  //  - Deactivating or deleting an *account* is unaffected, and still takes
  //    effect on the very next request. That is enforced by the `isActive` check
  //    against our own database below, not by anything Supabase says.
  //  - Signing out is unaffected. `auth.logout` clears every session cookie on
  //    the response, so the browser stops presenting the token at once.
  //  - What is left is a token that has been copied out of the cookie jar and
  //    replayed elsewhere, which would work until it expires rather than being
  //    refused immediately. Narrowing that means shortening the access-token
  //    lifetime in the Supabase project, which is an operator setting and not
  //    something this process can decide.
  const { data: sessionData, error: sessionError } =
    await supabase.auth.getSession();

  const accessToken = sessionData.session?.access_token;

  if (sessionError || !accessToken) return null;

  const authUserId = await resolveSubject(supabase, accessToken);

  if (!authUserId) return null;

  // First, because everything below this line is a statement about somebody who
  // presented a session, and "no session is not an error" is true whether or
  // not the database is there.
  if (!(await getDb())) {
    throw new Error(
      "The platform cannot reach its database, so your account could not be checked. Nothing is wrong with your account — try again shortly, and tell the platform administrator if it continues."
    );
  }

  const user = await getUserByAuthUserId(authUserId);

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

  // Written at most this often, rather than on every request that carries a
  // session. The field records when an officer was last seen, and a screen that
  // fires four requests would otherwise record four sign-ins.
  //
  // The cost was not four writes. It was that they all target the *same row*:
  // every request from one officer contends for that row's lock, so a page that
  // loads in parallel turns into a queue of transactions each waiting on the
  // one before it. On a deployment whose database allows 200 connections, that
  // queue is what exhausted them — `EMAXCONN: max client connections reached` —
  // and it surfaced as screens that never finished loading rather than as
  // anything that named a limit. Throttling turns a page of parallel requests
  // into one write and some reads, which is what it should have been.
  //
  // Five minutes is short enough that "last seen" stays true for an oversight
  // screen, and long enough that ordinary use writes once and then stops.
  const lastSignedIn = user.lastSignedIn;
  const stale =
    !lastSignedIn ||
    Date.now() - lastSignedIn.getTime() >= LAST_SIGNED_IN_RESOLUTION_MS;

  if (stale) {
    await touchLastSignedIn(user.id, new Date());
  }

  return {
    ...user,
    authUserId,
    sessionId: sessionIdFromAccessToken(accessToken),
  } as AuthenticatedUser;
}

/**
 * The Supabase user id a token belongs to, or null if it names nobody.
 *
 * The distinction this exists for is between *"this token is not acceptable"*
 * and *"we could not go and check"*, which look identical from outside and must
 * not be treated the same way.
 *
 * `getClaims` verifies the signature locally against the project's key set, but
 * the first time a process needs a key it has to fetch it — so a cold start, or
 * any instance whose cached copy has expired, depends on that network call. A
 * transient failure there is not a bad token, and treating it as one is the
 * difference between a brief blip and the entire platform deciding that every
 * officer is signed out at the same moment. So a retryable fetch failure falls
 * back to asking Supabase, which is slower and always worked.
 *
 * Everything else is taken at face value. An expired token — the ordinary case,
 * and the one a stale tab produces — is a genuine "not signed in yet" and is
 * answered as one rather than as a hard error.
 *
 * Note that `getClaims` already falls back to `getUser` on its own when the
 * project signs symmetrically or when WebCrypto is missing; this is the other
 * direction, for the case where the fast path cannot run at all.
 */
async function resolveSubject(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  accessToken: string
): Promise<string | null> {
  const { data: claimData, error: claimError } =
    await supabase.auth.getClaims(accessToken);

  if (claimError || !claimData) {
    // Not a verdict on the token — the answer could not be fetched. Ask Supabase
    // instead, which is the slower question but can actually be reached.
    if (claimError && isAuthRetryableFetchError(claimError)) {
      const { data: userData, error: userError } =
        await supabase.auth.getUser(accessToken);
      if (userError || !userData.user) return null;
      return userData.user.id;
    }

    return null;
  }

  // `sub` is the Supabase user id, and it is the join between the two systems:
  // the credential's own record and the row in our register. Nothing else in
  // the token is used for identity.
  const subject = claimData.claims.sub;

  return typeof subject === "string" && subject ? subject : null;
}

/**
 * The session id out of an access token, or null.
 *
 * GoTrue puts a `session_id` claim in every access token, and that claim is the
 * only thing that distinguishes one signed-in device from another: the officer's
 * user id is the same on all of them. So this is what lets "sign out my other
 * devices" know which sessions to leave alone — and getting it wrong in the
 * permissive direction would sign the officer out of the device they are sitting
 * at, which is why an unreadable token yields null rather than a guess.
 *
 * The token's *signature* is not checked here and does not need to be: it was
 * verified a few lines above — against Supabase's JWKS, or against Supabase
 * itself if this project signs symmetrically — and this only reads a claim out
 * of already-trusted bytes to name a session. Verifying it again would need
 * `JWT_SECRET`, which this application deliberately does not hold.
 */
function sessionIdFromAccessToken(
  accessToken: string | undefined
): string | null {
  if (!accessToken) return null;
  const [, payload] = accessToken.split(".");
  if (!payload) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8")
    ) as { session_id?: unknown };
    return typeof claims.session_id === "string" && claims.session_id
      ? claims.session_id
      : null;
  } catch {
    return null;
  }
}
