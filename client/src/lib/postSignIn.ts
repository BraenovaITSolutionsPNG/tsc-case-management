/**
 * The hand-off from the sign-in screen to the platform.
 *
 * A sign-in ends with a full-page navigation, so nothing survives it in memory —
 * the new document starts with no way of knowing that the officer has just
 * signed in, as against having arrived at the platform by other means. The
 * sign-in screen therefore leaves one note in `sessionStorage`, and the layout
 * picks it up once.
 *
 * `sessionStorage` and not `localStorage` on purpose. This is a fact about the
 * tab that just signed in, and it should not outlive it: an officer who signs in
 * on one tab, opens a second, and finds a branding animation playing there too
 * has been shown something untrue about that tab. Storage is also per-origin and
 * cleared when the tab closes, so a stale note cannot greet someone days later.
 *
 * Read with `consumePostSignIn`, which clears as it reads. That is what makes it
 * a hand-off rather than a setting: a refresh of the destination should still
 * show the screen, because the officer arriving there *is* arriving from a
 * sign-in, but the second navigation afterwards must not.
 */

/** Storage key. Prefixed so it is not mistaken for one of the app's own. */
const FLAG = "tsc-post-sign-in";

/**
 * How long the post-sign-in screen holds before the platform is handed over.
 *
 * A floor, not a fixed duration: the platform is revealed the moment both this
 * much time has passed and the platform's own queries have settled, so a slow
 * server round trip is never cut short and a fast one is never rushed.
 *
 * 2600ms because the mark takes 2000ms to assemble and then stops, and the floor
 * has to clear that or the handover would interrupt the one animation this screen
 * exists to show. The remaining 600ms is the rest — the mark formed and still,
 * the bar full, nothing moving — before it dissolves. Cutting at 2000 would hand
 * over on the frame the mark completes, which reads as the animation being
 * interrupted rather than as finishing.
 */
export const BOOT_MINIMUM_MS = 2600;

/**
 * How long the handover takes.
 *
 * The loader fades out over this while the platform fades in beneath it, so the
 * two are briefly both visible and neither arrives as a cut. Long enough to read
 * as a transition, short enough that the platform feels immediate once it is
 * there. The fade duration in `index.css` must match this number, or the overlay
 * is removed while it is still visible and the last few frames are the hard cut
 * this exists to avoid.
 */
export const BOOT_FADE_MS = 500;

/**
 * The ceiling, and the reason this module is safe to trust.
 *
 * A loading screen that cannot be dismissed is indistinguishable from a broken
 * application, and this one covers the whole viewport. So regardless of what the
 * session is doing — a request that never settles, a query that retries, a
 * network that has gone away — it comes down after this long and the platform is
 * shown in whatever state it turns out to be in. A skeleton or a half-drawn
 * screen is a lesser problem than a permanent one, and the officer can always
 * reload.
 *
 * Comfortably more than the floor plus the fade, so the ceiling is only ever
 * reached by something that has actually gone wrong.
 */
export const BOOT_CEILING_MS = 8000;

/**
 * The event the sign-in screen fires alongside the note.
 *
 * The note in storage covers the case where the platform is entered as a *new
 * document*. It cannot cover the ordinary one: the sign-in screen and the
 * platform it opens are the same document on a client-side navigation, so
 * anything already mounted — the gate that draws the branded screen — is
 * looking at a state that will not change on its own. The event is how the
 * screen tells it.
 *
 * A DOM event rather than a shared exported callback because the two live on
 * either side of a routing boundary and neither should have to import the
 * other's React tree. `CustomEvent` is used directly for the same reason:
 * `Event` would not carry a detail, and the detail is the whole message.
 */
const EVENT = "tsc:post-sign-in";

/** Called by the sign-in screen once the credential has been accepted. */
export function markPostSignIn(): void {
  // A browser with storage disabled throws here rather than returning null, and
  // this runs on the path into the application. The screen is a nicety, so
  // failing to record the note must not stop the officer getting in — which is
  // why the caller navigates either way and this only says "no note".
  try {
    window.sessionStorage.setItem(FLAG, "1");
  } catch {
    // Storage unavailable. The platform still opens; it just opens without the
    // branded screen.
  }

  // Dispatched outside the try: a listener that cannot be told is not a reason
  // to withhold the note, and a dispatch on a browser without CustomEvent is a
  // browser this app does not support.
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    // No event to send. The note alone still covers a new-document entry.
  }
}

/**
 * Subscribes to the sign-in hand-off. Returns the unsubscribe function.
 *
 * Safe to call during render, which is how the gate uses it: the subscription
 * is torn down by the effect that made it, and the callback is only ever invoked
 * from an event, never during the subscription itself.
 */
export function onPostSignIn(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/**
 * Whether a note is waiting, without consuming it.
 *
 * Separate from `consumePostSignIn` because the note is now read by more than
 * one place in sequence. App Router renders `app/loading.tsx` for the round trip
 * between the sign-in screen and the first paint of the platform, and that has
 * to *see* the note to know it should draw the branded screen rather than the
 * ordinary one. If reading it cleared it, the layout would find nothing by the
 * time it mounted and hand over to a loader that was never shown.
 *
 * So the sequence is: peek, draw, and then consume once — in the layout, which
 * is the last reader and the one that owns the handover.
 */
export function peekPostSignIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

/**
 * Reads the note and clears it, so exactly one reader acts on it.
 *
 * Returns false when there is no note, when storage is unavailable, or when this
 * is not the browser at all.
 */
export function consumePostSignIn(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const set = window.sessionStorage.getItem(FLAG) === "1";
    // Cleared whether or not it was set, so a flag written by an older build
    // cannot be picked up twice.
    window.sessionStorage.removeItem(FLAG);
    return set;
  } catch {
    return false;
  }
}
