import { UNAUTHED_ERR_MSG } from "./const";

/**
 * Whether a failure means "your session is gone, go and sign in again".
 *
 * Exported as a predicate rather than left inline in the provider that acts on
 * it, because the whole mechanism rests on an exact string comparison across a
 * process boundary and had nothing asserting it. Both sides import
 * `UNAUTHED_ERR_MSG` from `./const`, so they cannot drift by editing one of
 * them — but they can drift in the ways this function exists to rule out:
 *
 *  - the server changing the wording of its refusal, which would leave an
 *    expired officer stranded on a half-broken screen with no sign-in prompt;
 *  - the comparison loosening to a `includes`, which would make *any* message
 *    containing that text count, so a routine refusal would sign an officer out
 *    mid-task;
 *  - a `FORBIDDEN` being mistaken for an expiry, which would eject somebody for
 *    lacking a capability rather than for having lost their session.
 *
 * Structural rather than `instanceof`, deliberately. The value arrives in the
 * browser as a `TRPCClientError`, but the same check is wanted of the plain
 * `{ message }` shape in tests and of anything a caller reconstructs, and the
 * one thing that matters is the message the server actually threw.
 */
export function isUnauthenticatedError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const message = (error as { message?: unknown }).message;

  // Exact, not a substring: this is the difference between "the session ended"
  // and "the session ended *and* here is why", and a loose match here would
  // sign officers out over a capabilities message that happens to quote the same
  // text.
  return typeof message === "string" && message === UNAUTHED_ERR_MSG;
}
