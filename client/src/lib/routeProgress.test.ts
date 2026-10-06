import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GIVE_UP_MS,
  MIN_VISIBLE_MS,
  SHOW_DELAY_MS,
  createRouteProgress,
} from "./routeProgress";

/**
 * The route-change bar's timing, which is the whole of its behaviour.
 *
 * The property that matters most is what does *not* happen. The navigation items
 * in this app are real `<Link>`s behind prefetched payloads, so most tab changes
 * commit well inside a frame or two; a bar that appeared for those would be the
 * disruptive full-screen takeover the platform deliberately removed, only
 * smaller. So the majority of navigations must produce no state change at all,
 * and the first three tests here are all about that silence.
 *
 * These needed no browser because the timing was lifted out of the component
 * into this module. The component now decides nothing but when to call `begin`
 * and `end`.
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Records every state change, so "nothing happened" is assertable. */
function harness() {
  const states: boolean[] = [];
  const progress = createRouteProgress(visible => states.push(visible));
  return { progress, states };
}

describe("a navigation that finishes quickly", () => {
  it("shows nothing at all", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS - 10);
    progress.end();
    vi.advanceTimersByTime(5_000);

    // The point of the delay. An officer moving between two tabs should see the
    // screen change and nothing else.
    expect(states).toEqual([]);
  });

  it("paints on the boundary itself, and says so", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    progress.end();
    vi.advanceTimersByTime(5_000);

    // Stated rather than left ambiguous: the delay timer fires at exactly
    // `SHOW_DELAY_MS` and `end()` arriving at the same instant does not beat it,
    // so a navigation that takes the full delay does get a bar. That is the
    // intended reading — the delay is the point at which silence stops being the
    // better answer — and it is asserted here so a change to the tie is a
    // deliberate one rather than a surprise.
    expect(states).toEqual([true, false]);
  });

  it("leaves no timer behind that could fire later", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS - 10);
    progress.end();
    // Long past the give-up window, which is the one that would have fired.
    vi.advanceTimersByTime(GIVE_UP_MS * 2);

    expect(states).toEqual([]);
  });
});

describe("a navigation that is genuinely slow", () => {
  it("appears once the delay is outrun, and not before", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS - 1);
    expect(states).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(states).toEqual([true]);
  });

  it("stays up for as long as the navigation runs", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(10_000);
    expect(states).toEqual([true]);

    // Nothing more while it is still going. The give-up window is measured from
    // when the navigation began, not from when the bar appeared, so this stays
    // inside it rather than adding to it.
    vi.advanceTimersByTime(GIVE_UP_MS - 10_000 - 1);
    expect(states).toEqual([true]);
  });

  it("is held briefly after it commits rather than vanishing in one frame", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    progress.end();

    // Immediately after committing, still up: a bar that appeared and went in
    // the same frame reads as a glitch rather than as progress.
    expect(states).toEqual([true]);
    vi.advanceTimersByTime(MIN_VISIBLE_MS - 1);
    expect(states).toEqual([true]);

    vi.advanceTimersByTime(1);
    expect(states).toEqual([true, false]);
  });

  it("counts the hold from when it appeared, not from when it ended", () => {
    const { progress, states } = harness();

    // Appears at t=SHOW_DELAY_MS, so the hold runs to
    // SHOW_DELAY_MS + MIN_VISIBLE_MS however long the navigation then took.
    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS + 400);
    progress.end();

    // t = SHOW_DELAY_MS + MIN_VISIBLE_MS - 1. Still up, one millisecond short.
    vi.advanceTimersByTime(MIN_VISIBLE_MS - 401);
    expect(states).toEqual([true]);

    vi.advanceTimersByTime(1);
    expect(states).toEqual([true, false]);
  });

  it("does not extend the hold when told twice", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS + 400);
    progress.end();

    // `end` runs once per pathname change and a route can settle more than once
    // (a redirect, or a search-param rewrite). Restarting the hold each time
    // would keep the bar up well past the navigation.
    vi.advanceTimersByTime(100);
    progress.end();
    vi.advanceTimersByTime(100);
    progress.end();

    vi.advanceTimersByTime(MIN_VISIBLE_MS);
    expect(states).toEqual([true, false]);
  });
});

describe("a navigation that never commits", () => {
  it("gives up rather than covering the screen for ever", () => {
    const { progress, states } = harness();

    // A link whose handler prevented the navigation, or a server render that
    // threw. The pathname never changes, so `end` is never called.
    progress.begin();
    vi.advanceTimersByTime(GIVE_UP_MS - 1);
    expect(states).toEqual([true]);

    vi.advanceTimersByTime(1);
    expect(states).toEqual([true, false]);
  });

  it("has stopped listening by the time it gives up", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(GIVE_UP_MS);
    progress.end();

    vi.advanceTimersByTime(MIN_VISIBLE_MS);
    // One change to hide, and nothing after it: a late `end` must not queue a
    // second hide behind the give-up.
    expect(states).toEqual([true, false]);
  });
});

describe("back-to-back navigations", () => {
  it("restarts the delay for the one that replaced it", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS - 50);
    progress.begin();
    // The first one's delay must have been cancelled, not left to fire and show
    // a bar for a navigation that was superseded.
    vi.advanceTimersByTime(50);
    expect(states).toEqual([]);

    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(states).toEqual([true]);
  });

  it("is not held up by the navigation it replaced", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(states).toEqual([true]);

    // A second navigation starts while the first is still being announced.
    progress.begin();
    progress.end();
    vi.advanceTimersByTime(MIN_VISIBLE_MS);

    expect(states).toEqual([true, false]);
  });
});

describe("disposal", () => {
  it("leaves nothing running", () => {
    const { progress, states } = harness();

    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS);
    expect(states).toEqual([true]);

    // The bar unmounting with the tree. If these survived, they would call
    // `onVisible` on a component that no longer exists.
    progress.dispose();
    vi.advanceTimersByTime(GIVE_UP_MS * 2);

    expect(states).toEqual([true]);
  });

  it("can be started again afterwards", () => {
    const { progress, states } = harness();

    progress.begin();
    progress.dispose();
    progress.begin();
    vi.advanceTimersByTime(SHOW_DELAY_MS);

    expect(states).toEqual([true]);
  });
});
