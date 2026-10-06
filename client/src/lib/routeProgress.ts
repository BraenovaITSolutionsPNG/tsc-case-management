/**
 * The timing behind the route-change bar, with no DOM in it.
 *
 * This exists as a module of its own so the decisions can be tested without a
 * browser. The whole design is three numbers and the order they fire in, and
 * that is precisely the thing a component hides: in a component the timing is
 * interleaved with event listeners, refs and `setState`, so "does the bar stay
 * hidden for a navigation that finishes in 200ms" is a question that can only be
 * answered by driving a real browser. Here it is a function and a fake clock.
 *
 * The component keeps the DOM and nothing else — listening for link clicks,
 * subscribing to the route-change signal, painting a two-pixel line — and defers
 * every question about *when* to this file.
 */

/** How long a navigation must be slow before the bar is worth painting. */
export const SHOW_DELAY_MS = 150;

/**
 * How long the bar is held once it appears, so a navigation that crosses the
 * delay and then finishes does not produce a bar that flashes for a single
 * frame — which reads as a glitch rather than as progress.
 */
export const MIN_VISIBLE_MS = 450;

/**
 * A navigation that has not committed this long is treated as never arriving.
 *
 * There is no completion event beyond the pathname changing, so without this the
 * bar would be left up indefinitely by a navigation that threw on the server.
 * The error boundary takes over in that case; this only has to stop
 * contradicting it.
 */
export const GIVE_UP_MS = 15_000;

/** Injected so tests can drive the clock. Defaults to the real one. */
export type ProgressTimers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
};

const realTimers: ProgressTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: handle => clearTimeout(handle as never),
  now: () => Date.now(),
};

export type RouteProgress = {
  /**
   * A navigation has started. Nothing is painted yet — the delay decides whether
   * the bar is ever needed at all, and that is the entire point of it.
   */
  begin: () => void;
  /**
   * The navigation committed, or gave up. Brings the bar down, held for the
   * remainder of `MIN_VISIBLE_MS` if it had managed to appear.
   */
  end: () => void;
  /** Clears every timer. Called when the bar unmounts. */
  dispose: () => void;
};

/**
 * Builds the controller. `onVisible` is told only about changes worth a render.
 *
 * A navigation that is begun and ends inside `SHOW_DELAY_MS` never calls it at
 * all, which is the behaviour the whole feature rests on and the first thing the
 * tests below assert.
 */
export function createRouteProgress(
  onVisible: (visible: boolean) => void,
  timers: ProgressTimers = realTimers
): RouteProgress {
  let pending = false;
  // Null until the bar has actually been painted, and back to null once it has
  // been taken down. This is the distinction the whole design turns on: a
  // navigation that finished inside the delay has never shown anything, so
  // there is nothing to bring down and nothing to announce.
  let shownAt: number | null = null;
  let showHandle: unknown = null;
  let giveUpHandle: unknown = null;
  let hideHandle: unknown = null;

  function clearAll() {
    if (showHandle !== null) timers.clearTimeout(showHandle);
    if (giveUpHandle !== null) timers.clearTimeout(giveUpHandle);
    if (hideHandle !== null) timers.clearTimeout(hideHandle);
    showHandle = null;
    giveUpHandle = null;
    hideHandle = null;
  }

  function hide() {
    shownAt = null;
    onVisible(false);
  }

  function begin() {
    pending = true;
    clearAll();

    showHandle = timers.setTimeout(() => {
      showHandle = null;
      // Cancelled while the delay was running.
      if (!pending) return;
      shownAt = timers.now();
      onVisible(true);
    }, SHOW_DELAY_MS);

    giveUpHandle = timers.setTimeout(() => {
      giveUpHandle = null;
      pending = false;
      // Nothing to hide if it never appeared — the same silence as a quick
      // navigation, and the reason this is conditional rather than unconditional.
      if (shownAt !== null) hide();
    }, GIVE_UP_MS);
  }

  function end() {
    if (!pending) return;
    pending = false;

    if (showHandle !== null) {
      timers.clearTimeout(showHandle);
      showHandle = null;
    }
    if (giveUpHandle !== null) {
      timers.clearTimeout(giveUpHandle);
      giveUpHandle = null;
    }

    // Never appeared. The navigation was quick, nothing was painted, and
    // announcing a hide for a bar nobody saw would be the one thing this
    // controller does that a component cannot ignore.
    if (shownAt === null) return;

    // Already on the way down; leave the existing hold alone rather than
    // restarting it, or repeated completions would keep the bar up for ever.
    if (hideHandle !== null) return;

    const held = MIN_VISIBLE_MS - (timers.now() - (shownAt as number));
    hideHandle = timers.setTimeout(
      () => {
        hideHandle = null;
        hide();
      },
      Math.max(0, held)
    );
  }

  return { begin, end, dispose: clearAll };
}
