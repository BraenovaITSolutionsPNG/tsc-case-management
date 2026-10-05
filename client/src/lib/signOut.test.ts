import { afterEach, describe, expect, it, vi } from "vitest";

import { beginSignOut, onSignOut } from "./signOut";

/**
 * The sign-out signal, which is the whole of this module.
 *
 * The properties worth pinning down are the ones about failing safe: the
 * event has to reach a listener that is already mounted, leaving it has
 * to stop it, and a platform without a `window` has to be told nothing
 * rather than thrown at.
 */

/**
 * A `window` stand-in: a real `EventTarget`, which is what `window` is
 * for the two things this module does to it. The suite runs in the `node`
 * environment, so there is no `window` to patch and no jsdom to borrow
 * one from.
 */
function install() {
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    value: target,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, "window");
  vi.restoreAllMocks();
});

describe("the sign-out event", () => {
  it("reaches a listener without a document change", () => {
    // Sign-out ends in a full document load, so the loader covering it is
    // destroyed along with everything else. The event is the only way to
    // tell it the departure has started before the document goes.
    install();
    let heard = 0;
    const stop = onSignOut(() => {
      heard += 1;
    });

    beginSignOut();
    expect(heard).toBe(1);

    stop();
    beginSignOut();
    // Unsubscribed: a loader that has been torn down must not be called back.
    expect(heard).toBe(1);
  });

  it("sends nothing where there is no window at all", () => {
    // The server renders the tree too, and `window` does not exist there.
    // Raising the signal has to be an ordinary no-op rather than a throw,
    // because it runs on the path out of the platform.
    Reflect.deleteProperty(globalThis as object, "window");
    expect(() => beginSignOut()).not.toThrow();
    expect(() => onSignOut(() => {})()).not.toThrow();
  });
});
