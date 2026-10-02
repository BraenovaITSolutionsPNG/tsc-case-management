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
} from "@/lib/postSignIn";
import { useIsFetching } from "@tanstack/react-query";
import { useEffect, useState } from "react";

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
 * It lives above the router, in the root layout, rather than inside a screen,
 * and that placement is the whole point of it.
 *
 * A sign-in ends with a navigation that takes seconds: the dashboard is a Server
 * Component and resolves the session and the figures server-side, which on this
 * deployment is a three-way round trip before anything is painted. App Router
 * covers that window with `app/loading.tsx`, so with the branded screen inside a
 * screen the officer saw the ordinary loader for those seconds and *then* the
 * branded one — two loaders in a row, the first of which is the thing being
 * replaced. Put here instead, this mounts once and is already up before the
 * navigation is even started, and it stays up across the round trip.
 *
 * So the two halves of the fix are: this covers the server wait, and the sign-in
 * screen starts the navigation with `router.push` rather than a full document
 * load, which is what keeps this component mounted across it.
 *
 * It must never be a trap. It covers the viewport, so it is bounded three ways —
 * a floor, so the mark is seen at all; a ceiling, so a request that never
 * settles cannot leave an officer staring at a logo; and the platform's own
 * readiness, so the handover waits for real data rather than for a guess.
 */
export function PostSignInGate({ children }: { children: React.ReactNode }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startHandover() {
    setPhase("holding");
    // The floor starts now, not when the document was created: a slow server
    // round trip must not be spent out of the time the mark is on screen.
    setFloorPassed(false);
    // Re-armed for this handover, so the frame below is waited for again rather
    // than being satisfied by the one that happened on the way in.
    setPainted(false);
  }

  // The platform's own readiness: a resolved session and nothing in flight.
  const ready = !sessionState.isLoading && inFlight === 0;

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
    if (!floorPassed || !painted || !ready) return;
    setPhase("fading");
  }, [phase, floorPassed, painted, ready]);

  useEffect(() => {
    if (phase !== "fading") return;
    // Unmounts the screen once it has finished dissolving. BOOT_FADE_MS is the
    // same number the CSS transition runs for, so the screen is taken away at
    // the moment it has become invisible rather than while it is still going.
    const done = setTimeout(() => setPhase("off"), BOOT_FADE_MS);
    return () => clearTimeout(done);
  }, [phase]);

  useEffect(() => {
    if (phase === "off") return;
    // The ceiling. Whatever the session or the network is doing, this comes
    // down and the platform is shown in whatever state it turns out to be in.
    const ceiling = setTimeout(() => setPhase("off"), BOOT_CEILING_MS);
    return () => clearTimeout(ceiling);
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
        />
      )}
    </>
  );
}
