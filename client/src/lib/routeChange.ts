/**
 * The route-change signal.
 *
 * App Router offers no notification when a navigation *starts* — only that the
 * pathname changed once it finished. Something that wants to acknowledge the
 * wait (`RouteProgressBar`) therefore has to be told, rather than infer it.
 *
 * A DOM event rather than a shared exported callback, for the same reason
 * `signOut.ts` is one: the code that navigates and the code that watches are in
 * different parts of the tree, and neither should import the other's React
 * components.
 *
 * This is the second half of that pairing, and it exists because a link click is
 * not the only way the platform navigates. The sidebar and the buttons are real
 * `<Link>`s, which a listener on the document can see; the command palette, the
 * case rows on the overview and the jump to a just-registered matter all call
 * `router.push` directly, and those raised nothing at all — so the heaviest
 * navigation in the app was the one with no indicator. Rather than teach the
 * watcher to also guess about `router.push`, every navigation now comes through
 * one helper (`useRouteNavigate`) that says so.
 *
 * Redirects are deliberately not routed through here. `router.replace("/login")`
 * on a session that has expired is a bounce rather than a move, and drawing a
 * progress bar across the screen on the way out would be drawing it over the
 * answer the officer is being given.
 */

/** Raised when a navigation starts, so the route-change bar can cover the wait. */
const ROUTE_CHANGE_EVENT = "tsc:route-change";

/**
 * Called by anything that navigates without a link click, before it navigates.
 *
 * Failing safe, like `beginSignOut`: no window to dispatch on means no bar,
 * which is a cosmetic loss rather than a broken navigation. Every caller has
 * already committed to navigating by the time this returns.
 */
export function beginRouteChange(): void {
  try {
    window.dispatchEvent(new CustomEvent(ROUTE_CHANGE_EVENT));
  } catch {
    // No event to send. The navigation still happens; it just is not announced.
  }
}

/**
 * Notified when a navigation starts. Returns the unsubscribe function.
 *
 * Safe to call during render, which is how `RouteProgressBar` uses it: the
 * subscription is torn down by the effect that made it, and the callback is only
 * ever invoked from an event.
 */
export function onRouteChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(ROUTE_CHANGE_EVENT, handler);
  return () => window.removeEventListener(ROUTE_CHANGE_EVENT, handler);
}
