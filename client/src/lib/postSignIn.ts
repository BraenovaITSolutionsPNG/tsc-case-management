/**
 * The hand-off from the sign-in screen to the platform.
 *
 * The branded screen shows once, between a credential being accepted and the
 * platform being usable, and never again. That "never again" is the whole
 * difficulty: a refresh, a click between tabs, a second tab, and a restored tab
 * all look superficially like arriving at the platform, and three of them are
 * common. So this note is a single value that is written once and *taken* once,
 * by the last reader, and anything that could make it survive is refused below.
 *
 * `sessionStorage` and not `localStorage` on purpose. This is a fact about the
 * tab that just signed in, and it should not outlive it: an officer who signs in
 * on one tab, opens a second, and finds a branding animation playing there too
 * has been shown something untrue about that tab.
 *
 * The sign-in screen navigates without a document load, so the note is not the
 * only signal — `onPostSignIn` carries the same fact to a gate that is already
 * mounted. The note covers the case where the platform is entered as a new
 * document anyway.
 */

/** Storage key. Prefixed so it is not mistaken for one of the app's own. */
const FLAG = "tsc-post-sign-in";

/**
 * How old a note may be and still be believed.
 *
 * A second reader is a bug, not a feature, so a note this old is discarded rather
 * than trusted. It exists because `sessionStorage` survives things the app does
 * not expect: a browser crash and restore, a tab reopened from a session history,
 * and — the ordinary case — an officer who signs in and then leaves the tab open
 * while they do something else and come back to it much later. None of those is
 * "the moment you signed in", and treating them as though it were would put a
 * branding animation in front of an officer who has been working for an hour.
 *
 * Comfortably longer than any plausible sign-in round trip, and shorter than the
 * gap between signing in and looking at the screen again.
 */
const NOTE_MAX_AGE_MS = 30_000;

/**
 * How long the post-sign-in screen holds before the platform is handed over.
 *
 * A floor, not a fixed duration: the platform is revealed the moment both this
 * much time has passed and the platform's own queries have settled, so a slow
 * server round trip is never cut short and a fast one is never rushed.
 *
 * 2200ms because the mark takes 2000ms to assemble and then stops, and the floor
 * has to clear that or the handover would interrupt the one animation this screen
 * exists to show. The remaining 200ms is just enough of a rest that the mark is
 * seen finished — formed, still, bar full — rather than caught mid-assembly.
 *
 * Longer than that is dead time, and it was the thing that made the handover feel
 * reluctant: the officer watches a motionless logo while their register has
 * already loaded behind it. Everything the screen waits for beyond this floor is
 * real work arriving, not padding.
 */
export const BOOT_MINIMUM_MS = 2200;

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
    // The time is stored alongside the flag rather than a bare "1", because "is
    // this note still believable" is a question about *when* it was left, and a
    // flag with no age cannot answer it.
    window.sessionStorage.setItem(FLAG, String(Date.now()));
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
    const raw = window.sessionStorage.getItem(FLAG);
    if (raw === null) return false;

    const at = Number(raw);
    // Not a number means a note written by an older build, which stored a bare
    // "1" and carried no time. There is no way to age it, so it is not believed:
    // showing the screen for a sign-in nobody can date is the worse of the two
    // failures.
    if (!Number.isFinite(at)) return false;

    return Date.now() - at < NOTE_MAX_AGE_MS;
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
    const set = peekPostSignIn();
    // Cleared whether or not it was set, so a flag written by an older build
    // cannot be picked up twice.
    window.sessionStorage.removeItem(FLAG);
    return set;
  } catch {
    return false;
  }
}

/**
 * Whether the branded screen is currently up.
 *
 * The platform's own full-screen loader and this one must never be on screen at
 * the same time. The handover navigates, and that navigation is a route change
 * like any other, so the platform loader would answer it and put a second
 * takeover over the first — which is the sequence of two loaders this whole
 * mechanism exists to avoid, just in the other order.
 *
 * A module-level flag rather than a DOM attribute because the two components are
 * siblings under the root layout and neither is an ancestor of the other, so
 * there is nothing to read a context from that both can see.
 */
let handoverActive = false;

const HANDOVER_EVENT = "tsc:handover";

/** Called by the gate as it enters and leaves the branded screen. */
export function setHandoverActive(active: boolean): void {
  if (handoverActive === active) return;
  handoverActive = active;
  try {
    window.dispatchEvent(
      new CustomEvent(HANDOVER_EVENT, { detail: { active } })
    );
  } catch {
    // No CustomEvent. The flag itself is still set, so a later reader that asks
    // directly is correct; only a listener already mounted would miss the change.
  }
}

export function isHandoverActive(): boolean {
  return handoverActive;
}

/**
 * Notified when the branded screen goes up or comes down. Calls the listener
 * immediately with the current state, so a component that mounts mid-handover
 * does not have to guess and briefly shows itself.
 */
export function onHandoverChange(
  listener: (active: boolean) => void
): () => void {
  if (typeof window === "undefined") return () => {};
  listener(handoverActive);
  const handler = (event: Event) =>
    listener((event as CustomEvent<{ active: boolean }>).detail.active);
  window.addEventListener(HANDOVER_EVENT, handler);
  return () => window.removeEventListener(HANDOVER_EVENT, handler);
}

/**
 * Raised when the officer signs out, so the platform's own loader can cover the
 * sign-out rather than the page quietly changing under them.
 *
 * Sign-out ends in a full document load of `/login`, so there is no route change
 * to observe — the document simply goes. An event is the only way to say "this
 * is happening now" to something that is about to be destroyed.
 */
const SIGNOUT_EVENT = "tsc:signing-out";

export function beginSignOut(): void {
  try {
    window.dispatchEvent(new CustomEvent(SIGNOUT_EVENT));
  } catch {
    // No event. The sign-out still completes; it just is not covered.
  }
}

export function onSignOut(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener();
  window.addEventListener(SIGNOUT_EVENT, handler);
  return () => window.removeEventListener(SIGNOUT_EVENT, handler);
}
