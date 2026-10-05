/**
 * The sign-out signal.
 *
 * Sign-out ends in a full document load, so there is no route change to
 * observe — the document simply goes. An event is the only way to say
 * "this is happening now" to something that is about to be destroyed:
 * the platform's own loader covers the departure, so the officer is
 * told the platform heard them rather than watching the page quietly
 * change underneath them.
 *
 * A DOM event rather than a shared exported callback, because the two
 * sides — the hook that signs out and the loader that covers it — live
 * in different parts of the tree and neither should import the other's
 * React components. `CustomEvent` is used directly for the same reason:
 * `Event` would carry no detail, and the detail is the whole message.
 */

/** Raised when the officer signs out, so the platform's loader can cover it. */
const SIGNOUT_EVENT = "tsc:signing-out";

/** Called by the hook that signs the officer out, before the document goes. */
export function beginSignOut(): void {
  try {
    window.dispatchEvent(new CustomEvent(SIGNOUT_EVENT));
  } catch {
    // No event to send. The sign-out still completes; it just is not covered.
  }
}

/**
 * Notified when the officer signs out. Returns the unsubscribe function.
 *
 * Safe to call during render, which is how the loader uses it: the
 * subscription is torn down by the effect that made it, and the callback
 * is only ever invoked from an event, never during the subscription
 * itself.
 */
export function onSignOut(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(SIGNOUT_EVENT, handler);
  return () => window.removeEventListener(SIGNOUT_EVENT, handler);
}
