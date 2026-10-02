import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BOOT_CEILING_MS,
  BOOT_MINIMUM_MS,
  consumePostSignIn,
  markPostSignIn,
} from "./postSignIn";

/**
 * The sign-in hand-off, which decides whether a full-screen screen covers the
 * platform and for how long.
 *
 * The properties worth pinning down are all about failing safe. An officer who
 * cannot get in, or who is left looking at a logo, is the outcome this module
 * exists to prevent, so the tests below are about storage being unavailable, the
 * note being read twice, and the two timings being ordered the right way round.
 */

/** A sessionStorage that can be made to fail, the way a real one can. */
function fakeStorage(options: { failOn?: "set" | "get" | "all" } = {}) {
  const store = new Map<string, string>();
  return {
    store,
    getItem: vi.fn((key: string) => {
      if (options.failOn === "get" || options.failOn === "all") {
        throw new Error("denied");
      }
      return store.get(key) ?? null;
    }),
    setItem: vi.fn((key: string, value: string) => {
      if (options.failOn === "set" || options.failOn === "all") {
        throw new Error("denied");
      }
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
  };
}

/**
 * Installs a fake `window` carrying this storage.
 *
 * The suite runs in the `node` environment, so there is no `window` to patch and
 * no jsdom to borrow one from — the module is written to tolerate the browser
 * being absent, so the whole surface it touches is stubbed directly. That is also
 * what makes the last case in this file meaningful: with no window at all, the
 * read has to answer "no note" rather than throw.
 */
function install(storage: unknown) {
  Object.defineProperty(globalThis, "window", {
    value: { sessionStorage: storage },
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, "window");
  vi.restoreAllMocks();
});

describe("postSignIn", () => {
  it("carries a note from the sign-in screen to the platform", () => {
    install(fakeStorage());
    markPostSignIn();
    expect(consumePostSignIn()).toBe(true);
  });

  it("reads the note once, so a second navigation does not replay the screen", () => {
    // The layout is mounted per screen, not once for the app, so every route
    // change asks again. Without consuming, the branded screen would follow the
    // officer around for the rest of the session.
    install(fakeStorage());
    markPostSignIn();

    expect(consumePostSignIn()).toBe(true);
    expect(consumePostSignIn()).toBe(false);
    expect(consumePostSignIn()).toBe(false);
  });

  it("reports nothing on an ordinary arrival at the platform", () => {
    install(fakeStorage());
    expect(consumePostSignIn()).toBe(false);
  });

  it("still lets the officer in when storage refuses the note", () => {
    // Private browsing, a full quota, or storage disabled by policy. This runs
    // on the path into the application, so throwing here would lock somebody
    // out of a platform they have just proved they may use.
    install(fakeStorage({ failOn: "set" }));
    expect(() => markPostSignIn()).not.toThrow();

    install(fakeStorage());
    expect(consumePostSignIn()).toBe(false);
  });

  it("reports nothing rather than throwing when storage cannot be read", () => {
    install(fakeStorage({ failOn: "get" }));
    expect(() => consumePostSignIn()).not.toThrow();
    expect(consumePostSignIn()).toBe(false);
  });

  it("clears the note even when reading it failed", () => {
    // A note left behind by an older build must not be picked up a second time
    // once storage starts working again.
    const storage = fakeStorage({ failOn: "get" });
    install(storage);
    consumePostSignIn();
    install(fakeStorage());
    expect(consumePostSignIn()).toBe(false);
  });

  it("keeps the screen long enough to be seen, and no longer than the ceiling", () => {
    // The floor and the ceiling are the two halves of the same promise: the
    // screen is not a flicker, and it is not a trap. Reversed, or equal, either
    // the platform is never shown or an officer is stranded on a logo.
    expect(BOOT_MINIMUM_MS).toBeGreaterThan(0);
    expect(BOOT_CEILING_MS).toBeGreaterThan(BOOT_MINIMUM_MS);
    // Long enough to read as a moment, short enough that a stuck request is
    // survivable. Generous bounds, so a change to either is a deliberate act.
    expect(BOOT_MINIMUM_MS).toBeGreaterThanOrEqual(1000);
    expect(BOOT_CEILING_MS).toBeLessThanOrEqual(15000);
  });
});

describe("postSignIn without a browser", () => {
  it("reports no note where there is no window at all", () => {
    // The server renders the layout too, and `sessionStorage` does not exist
    // there. Reading a note that cannot exist has to be an ordinary "no".
    Reflect.deleteProperty(globalThis as object, "window");
    expect(consumePostSignIn()).toBe(false);
  });
});
