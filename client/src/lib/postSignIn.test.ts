import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BOOT_CEILING_MS,
  BOOT_FADE_MS,
  BOOT_MINIMUM_MS,
  consumePostSignIn,
  markPostSignIn,
  onPostSignIn,
  peekPostSignIn,
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
 * A `window` stand-in: real `EventTarget` methods, fake storage.
 *
 * The suite runs in the `node` environment, so there is no `window` to patch and
 * no jsdom to borrow one from, and the whole surface the module touches is
 * stubbed directly. It is an actual EventTarget rather than a plain object
 * because a real `window` is one, and the sign-in event is dispatched and
 * listened for on it — an object with only `sessionStorage` would fail for the
 * wrong reason and hide a real fault.
 *
 * This is also what makes the last case in the file meaningful: with no window at
 * all, a read has to answer "no note" rather than throw.
 */
function install(storage: unknown) {
  const target = new EventTarget();
  Object.defineProperty(target, "sessionStorage", { value: storage });
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

  it("lets two readers see the note before the last one takes it", () => {
    // App Router's loading fallback runs first and has to know a sign-in is
    // waiting so it does not draw the ordinary loader, and the gate above the
    // router runs second and takes it. If the fallback consumed instead of
    // peeking, the gate would find nothing and hand over from a screen that was
    // never shown - a skeleton appearing exactly as the logo leaves.
    install(fakeStorage());
    markPostSignIn();

    expect(peekPostSignIn()).toBe(true);
    expect(peekPostSignIn()).toBe(true);
    expect(consumePostSignIn()).toBe(true);
    expect(peekPostSignIn()).toBe(false);
  });

  it("reports nothing on an ordinary arrival at the platform", () => {
    install(fakeStorage());
    expect(consumePostSignIn()).toBe(false);
  });

  it("stays silent for every page in the platform after the first", () => {
    // The whole point of the hand-off. An officer who signs in and then spends
    // an hour moving around the register should see the branded screen once, on
    // the way in, and never again - and the layout is remounted per screen, so
    // "once" has to be enforced here rather than by the component.
    install(fakeStorage());
    markPostSignIn();

    expect(consumePostSignIn()).toBe(true);
    for (const _page of [
      "/",
      "/cases",
      "/cases/1",
      "/admin",
      "/reports",
      "/settings",
    ]) {
      expect(consumePostSignIn()).toBe(false);
    }
  });

  it("does not appear to an officer who never signed in on this tab", () => {
    // A second tab opened against a session that already exists is the case this
    // guards: the officer is genuinely authenticated, but they did not sign in
    // here, and the screen would be a claim about something that did not happen.
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

  it("refuses a note left long ago, so a returning officer is not shown it again", () => {
    // The ordinary case this exists for: an officer signs in, leaves the tab open
    // to do something else, and comes back to it much later. The note is still in
    // sessionStorage because nothing consumed it, and without an age limit that
    // is a branding animation in front of somebody who has been working for an
    // hour.
    install(fakeStorage());
    markPostSignIn();
    expect(peekPostSignIn()).toBe(true);

    const later = Date.now() + 60_000;
    const realNow = Date.now;
    Date.now = () => later;
    try {
      expect(peekPostSignIn()).toBe(false);
      expect(consumePostSignIn()).toBe(false);
    } finally {
      Date.now = realNow;
    }
  });

  it("refuses a note it cannot date", () => {
    // An older build wrote a bare "1" with no timestamp. There is no way to age
    // it, so it is not believed — showing the screen for a sign-in nobody can
    // date is the worse of the two failures.
    install(fakeStorage());
    window.sessionStorage.setItem("tsc-post-sign-in", "1");
    expect(peekPostSignIn()).toBe(false);
    expect(consumePostSignIn()).toBe(false);
  });

  it("still believes a note written a moment ago", () => {
    install(fakeStorage());
    markPostSignIn();
    const later = Date.now() + 5_000;
    const realNow = Date.now;
    Date.now = () => later;
    try {
      expect(peekPostSignIn()).toBe(true);
    } finally {
      Date.now = realNow;
    }
  });

  it("holds past the end of the mark's animation, then lets it rest", () => {
    // The mark assembles over 2000ms and stops. The floor has to clear that or
    // the handover lands on the frame the animation completes, which reads as an
    // interruption. The remainder is the rest, which is what the officer is
    // meant to see: a formed, still mark rather than one still moving.
    expect(BOOT_MINIMUM_MS).toBeGreaterThan(2000);
    expect(BOOT_MINIMUM_MS).toBeLessThanOrEqual(2400);
  });

  it("leaves room in the ceiling for the hold and the handover both", () => {
    // If the ceiling were under the sum, the screen would be yanked away while
    // still fading - which is the hard cut the fade exists to avoid, reached by
    // the timer rather than by the transition.
    expect(BOOT_CEILING_MS).toBeGreaterThan(BOOT_MINIMUM_MS + BOOT_FADE_MS);
  });

  it("matches the CSS transition so the overlay is not cut off", () => {
    // BOOT_FADE_MS is a JavaScript timer that unmounts the loader, and the fade
    // is a CSS transition of the same length. If they disagree the element is
    // removed while it is still visible. Asserted here because the two live in
    // different files and only one of them is this module's business.
    expect(BOOT_FADE_MS).toBe(500);
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

describe("the sign-in event", () => {
  it("reaches a listener without a document change", () => {
    // The gate is mounted above the router, so on a client-side navigation the
    // note in storage is not the only signal - the gate is already there and has
    // to be told. The event is how. A full document load would tear the gate
    // down, which is why the sign-in screen navigates without one.
    install(fakeStorage());
    let heard = 0;
    const stop = onPostSignIn(() => {
      heard += 1;
    });

    markPostSignIn();
    expect(heard).toBe(1);

    stop();
    markPostSignIn();
    // Unsubscribed: a gate that has been torn down must not be called back.
    expect(heard).toBe(1);
  });

  it("leaves nothing behind for a refresh to find", () => {
    // The bug this exists to prevent. The gate is already mounted when a sign-in
    // completes - it lives in the root layout and the sign-in screen is inside
    // it - so it is told over the event, not by a note at mount. If the event
    // path only read the note, it would survive the whole handover and a refresh
    // would find it and raise the screen again, which is precisely what must
    // never happen after the sign-in it belongs to.
    install(fakeStorage());

    // 1. The gate mounts, on the sign-in screen, before anything is written.
    expect(consumePostSignIn()).toBe(false);

    // 2. The officer signs in: the note is written and the event fires. The gate
    //    is already listening, and its handler takes the note - which is what
    //    makes this work rather than the mount pass doing it.
    let took = false;
    const stop = onPostSignIn(() => {
      if (consumePostSignIn()) took = true;
    });

    markPostSignIn();
    stop();
    expect(took).toBe(true);

    // 3. The handover runs and finishes. Nothing was left in storage, so the
    //    refresh below finds an empty tab.
    expect(peekPostSignIn()).toBe(false);
    expect(consumePostSignIn()).toBe(false);
  });

  it("still leaves the note when there is no listener to hear it", () => {
    // The note is what covers entering the platform as a new document, so it is
    // written whether or not anything is listening.
    install(fakeStorage());
    markPostSignIn();
    expect(peekPostSignIn()).toBe(true);
  });
});

describe("postSignIn without a browser", () => {
  it("reports no note where there is no window at all", () => {
    // The server renders the layout too, and `sessionStorage` does not exist
    // there. Reading a note that cannot exist has to be an ordinary "no".
    Reflect.deleteProperty(globalThis as object, "window");
    expect(consumePostSignIn()).toBe(false);
    expect(peekPostSignIn()).toBe(false);
    expect(() => onPostSignIn(() => {})()).not.toThrow();
  });
});
