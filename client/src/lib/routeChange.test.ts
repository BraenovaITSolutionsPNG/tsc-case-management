import { describe, expect, it } from "vitest";

import { beginRouteChange, onRouteChange } from "./routeChange";

/**
 * A `window` stand-in: a real `EventTarget`, which is all this module needs from
 * one. The suite runs in the `node` environment, so there is no `window` to patch
 * and no jsdom to borrow one from.
 */
function install(): EventTarget {
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    value: target,
    configurable: true,
    writable: true,
  });
  return target;
}

function removeWindow(): void {
  Reflect.deleteProperty(globalThis as object, "window");
}

describe("the route-change signal", () => {
  it("reaches a listener that is already mounted", () => {
    // The watcher is mounted in the root layout, and the code that navigates is
    // three levels down in a screen. The signal is the only thing that connects
    // them, so it has to arrive at a listener that subscribed earlier.
    install();
    let heard = 0;
    const stop = onRouteChange(() => {
      heard += 1;
    });

    beginRouteChange();
    expect(heard).toBe(1);

    stop();
    beginRouteChange();
    // Unsubscribed: a bar that has been torn down must not be called back.
    expect(heard).toBe(1);
  });

  it("reaches every listener, not just the first", () => {
    // There is only one watcher today, but a store that silently kept the first
    // subscriber would be a trap for the second one, and this is the only place
    // that can say so.
    install();
    let first = 0;
    let second = 0;
    const stopFirst = onRouteChange(() => {
      first += 1;
    });
    const stopSecond = onRouteChange(() => {
      second += 1;
    });

    beginRouteChange();

    expect(first).toBe(1);
    expect(second).toBe(1);
    stopFirst();
    stopSecond();
  });

  it("sends nothing where there is no window at all", () => {
    // The server renders these screens too, and `window` does not exist there.
    // Raising the signal has to be an ordinary no-op rather than a throw, since
    // it runs on the path *into* every screen.
    removeWindow();
    expect(() => beginRouteChange()).not.toThrow();
    expect(() => onRouteChange(() => {})()).not.toThrow();
  });
});
