"use client";

import { BootLoader } from "@/components/BootLoader";
import { trpc } from "@/lib/trpc";
import {
  BOOT_CEILING_MS,
  BOOT_FADE_MS,
  BOOT_MINIMUM_MS,
  consumePostSignIn,
  onPostSignIn,
  peekPostSignIn,
  setHandoverActive,
} from "@/lib/postSignIn";
import { useIsFetching } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { usePersistFn } from "@/hooks/usePersistFn";

/**
 * Where the post-sign-in hand-off has got to.
 *
 * Three states, because the handover has three moments and one flag cannot tell
 * them apart:
 *
 *   off      - nothing to show. The ordinary behaviour, and the only resting
 *              state: every path returns here, the ceiling included.
 *   holding  - the branded screen is up and the platform is still arriving.
 *   fading   - the platform is rendered beneath and the screen is dissolving
 *              off it.
 */
type Phase = "off" | "holding" | "fading";

/**
 * Draws the branded screen between a sign-in and the platform.
 *
 * Currently it draws nothing. The branded screen was disabled on
 * 2026-10-05: it was bounded by `BOOT_CEILING_MS`, so on a slow server
 * round trip it came down before the platform had arrived and the
 * officer was shown a second loading state directly after the logo —
 * two loaders in a row, the exact sequence this screen existed to
 * prevent. The sign-in screen no longer writes the note, so no handover
 * ever starts and this gate passes its children straight through.
 *
 * What stays, and why: the note is still consumed on mount, so one left
 * by an older build — or by a sign-in that re-enables the screen —
 * cannot sit in sessionStorage and be believed by a later reader; and
 * the machinery below stays intact, so the screen returns by writing the
 * note again rather than by rebuilding this component. The reasoning
 * below is kept because it is the reasoning the screen would return
 * with.
 */
/** The one route the branded screen is ever raised from. */
const SIGN_IN_ROUTE = "/login";

export function PostSignInGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("off");
  const [floorPassed, setFloorPassed] = useState(true);
  const [painted, setPainted] = useState(true);

  // `useIsFetching` rather than the layout's own loading flag, because the
  // layout is not the only thing that fetches. The dashboard asks for the
  // register, the figures and the provinces at once, and handing over while
  // those are still in flight is what puts a skeleton on screen at the moment
  // the branded screen leaves.
  const inFlight = useIsFetching();
  const sessionState = trpc.auth.me.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });

  // Whether the handover began on the sign-in screen, recorded at the moment it
  // starts. A gate that begins on a page the officer was already on - the
  // platform itself, on a hard load, where nothing navigates - must not sit
  // waiting for a route change that is never coming.
  const beganOnSignIn = useRef(false);

  /**
   * Puts the branded screen up, and records whether this handover is one that
   * still owes us a route change.
   *
   * `usePersistFn`, so the function the effect below subscribes keeps one
   * identity for the life of the component while still running the *current*
   * body. It was a plain function declaration closed over `pathname`, and that
   * effect subscribed with `[]` deps — so the listener held the version built on
   * the first render, with `pathname` frozen at whatever route the gate happened
   * to mount on. Sign-out never does a document load (`DashboardLayout` reaches
   * `/login` with `router.replace`, and `Settings` did the same), so the gate is
   * not remounted and that first-render route is what decided every later
   * handover. When the gate had mounted on a platform route — any hard load of
   * `/cases`, `/settings` and so on — `beganOnSignIn` was set `false`, which made
   * `routeArrived` unconditionally true and silently switched off the very check
   * described on it as the reason the arrival was smooth. The branded screen then
   * dissolved over the sign-in form while the dashboard arrived all at once
   * underneath it.
   */
  const startHandover = usePersistFn(() => {
    beganOnSignIn.current = pathname === SIGN_IN_ROUTE;
    // Published immediately, not on the next render. The handover navigates, and
    // that navigation is a route change like any other — without this the
    // platform's own loader would answer it and stack a second full-screen
    // takeover over this one.
    setHandoverActive(true);
    setPhase("holding");
    // The floor starts now, not when the document was created: a slow server
    // round trip must not be spent out of the time the mark is on screen.
    setFloorPassed(false);
    // Re-armed for this handover, so the frame below is waited for again rather
    // than being satisfied by the one that happened on the way in.
    setPainted(false);
  });

  // The note is taken by whoever acts on it, and both paths below act.
  //
  // They have to. The gate is already mounted by the time a sign-in completes —
  // it lives in the root layout, and the sign-in screen is inside it — so the
  // mount pass below finds nothing and returns. The note is then written by the
  // sign-in screen and arrives over the event. If the event path only *read* it,
  // the note would survive the whole handover, still sitting in sessionStorage,
  // and a refresh would find it there and put this screen up again — the exact
  // thing it is not supposed to do.
  //
  // `app/loading.tsx` peeks rather than takes, and is right to: it may render
  // before the gate has mounted at all, and a screen that took the note would
  // leave the gate nothing to hand over from.
  useEffect(() => {
    if (consumePostSignIn()) startHandover();
    return onPostSignIn(() => {
      if (consumePostSignIn()) startHandover();
    });
    // `startHandover` is stable, so this really does run once. The exhaustive-deps
    // suppression this replaces silenced the rule that would have pointed at the
    // stale closure above rather than at the deps being genuinely constant.
  }, [startHandover]);

  // The platform's own readiness: a resolved session and nothing in flight.
  //
  // Necessary and not sufficient, which is the whole of the next block. Queries
  // say nothing about whether the route has arrived.
  const ready = !sessionState.isLoading && inFlight === 0;

  // The route transition has committed.
  //
  // This is the check that was missing, and it is why the arrival was abrupt
  // rather than smooth. `router.push` streams the new page's RSC payload over the
  // network; until it lands, the committed pathname is still the sign-in screen
  // and that screen is what is under the branded loader. `inFlight` reports zero
  // the entire time, because no *query* has started — the payload has not
  // arrived to start one. So a handover decided on queries alone would dissolve
  // the loader over the sign-in form, and the dashboard would then appear all at
  // once. The whole transition played out over the wrong page.
  //
  // The committed pathname changing is the signal that the navigation finished,
  // because that is the moment App Router swaps the tree.
  const routeArrived = !beganOnSignIn.current || pathname !== SIGN_IN_ROUTE;

  // ...and one painted frame, so "nothing in flight" cannot be read in the gap
  // between the server-prefetched cache hydrating and the screen's first query
  // registering. Handing over in that gap is what puts a skeleton on screen at
  // the moment this screen leaves.
  useEffect(() => {
    if (!ready || painted) return;
    const frame = requestAnimationFrame(() => setPainted(true));
    return () => cancelAnimationFrame(frame);
  }, [ready, painted]);

  useEffect(() => {
    if (phase !== "holding") return;
    if (!floorPassed || !painted || !ready || !routeArrived) return;
    setPhase("fading");
  }, [phase, floorPassed, painted, ready, routeArrived]);

  useEffect(() => {
    if (phase !== "fading") return;
    // A backstop, not the mechanism. The screen normally unmounts itself when
    // the transition genuinely ends — see `onFadeEnd` — because a timer set to
    // the same number as the CSS transition drifts by a frame under load, and
    // removing the element with opacity still a hair above zero puts a snap at
    // exactly the moment the eye is following the fade. That snap is what made
    // the end of the handover read as rough.
    //
    // This exists because a transition event does not fire in every
    // circumstance — a browser that has dropped the transition, or a tab that was
    // hidden and never painted. If the event never comes, the screen still comes
    // down. Generously longer than the fade, so it can only ever be the thing
    // that saves the officer rather than the thing that ruins the handover.
    const backstop = setTimeout(() => setPhase("off"), BOOT_FADE_MS * 4);
    return () => clearTimeout(backstop);
  }, [phase]);

  useEffect(() => {
    if (phase === "off") return;
    // The ceiling. Whatever the session or the network is doing, this comes
    // down and the platform is shown in whatever state it turns out to be in.
    const ceiling = setTimeout(() => setPhase("off"), BOOT_CEILING_MS);
    return () => clearTimeout(ceiling);
  }, [phase]);

  // Whether the claim below has ever been made.
  //
  // Exists solely to stop this effect withdrawing a claim it never saw being
  // made. On the mount path — a fresh document load that lands on a note left in
  // sessionStorage — `startHandover` publishes from the first effect, and effects
  // then run in declaration order inside that one commit, so this effect was
  // reached with `phase` still at its initial `"off"` and published `false`.
  // That is the case the "published immediately" comment above exists for, and
  // it was the one path where the immediate publication was undone: the platform
  // loader saw `true` then `false` in the same commit, and the loader was
  // released for one render in the middle of a handover it should have stayed
  // down for.
  const claimed = useRef(false);

  // Every path back to "off" has to withdraw the claim, or the platform's own
  // loader would stay suppressed for the rest of the session. Done as an effect
  // on the phase rather than in each of the three places that sets it, so a
  // fourth cannot forget.
  useEffect(() => {
    const active = phase !== "off";
    // Nothing to withdraw until a claim has been made. On the mount path that
    // claim is published by `startHandover`, which runs earlier in this same
    // commit; publishing `false` here would undo it.
    if (!active && !claimed.current) return;
    claimed.current = active;
    setHandoverActive(active);
  }, [phase]);

  return (
    <>
      {children}

      {/*
       * Mounted in both `holding` and `fading`. During `holding` it is opaque
       * and covers a platform that has not arrived; during `fading` it is
       * dissolving off a platform that has. One element for both, so there is
       * no moment where neither is on screen.
       */}
      {phase === "off" ? null : (
        <BootLoader
          fading={phase === "fading"}
          minimumVisibleMs={BOOT_MINIMUM_MS}
          onMinimumElapsed={() => setFloorPassed(true)}
          onFadeEnd={() => setPhase("off")}
        />
      )}
    </>
  );
}
