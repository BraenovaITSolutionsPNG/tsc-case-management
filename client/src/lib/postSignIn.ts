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
 * The floor exists because a screen that appears for 200ms reads as a glitch
 * rather than as a moment. It is a floor and not a fixed duration: the platform
 * is revealed the moment both the session has resolved and this much time has
 * passed, so a slow boot is never cut short and a fast one is never rushed.
 *
 * Two seconds is the figure the transition was designed around — long enough for
 * the mark to finish assembling itself once (the animation runs on a 3.4s cycle,
 * so two seconds lands in the middle of the mark settling rather than after it
 * has finished) and short enough that an officer is not watching a logo while
 * their register waits behind it.
 */
export const BOOT_MINIMUM_MS = 2000;

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
}

/**
 * Reads the note and clears it, so exactly one screen sees it.
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
