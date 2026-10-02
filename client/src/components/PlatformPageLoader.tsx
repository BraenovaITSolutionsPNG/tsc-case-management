"use client";

import { PageLoader } from "@/components/BrandLoader";
import { onHandoverChange, onSignOut } from "@/lib/postSignIn";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * The platform's own full-screen loader, for signing out.
 *
 * This is the original loader — the ring, the arc and the case file — and it is
 * here for one job.
 *
 * It used to cover moving between the tabs as well, which turned out to be the
 * wrong instinct on both counts. A full-screen takeover is the most disruptive
 * thing an interface can do, and spending it on a move that takes a fraction of
 * a second means the officer's first impression of every other tab is a white
 * screen with a spinner that has already gone. It also made the app *feel*
 * slower, which is the opposite of what a loader is for: the bar it replaced was
 * easy to miss, and the takeover was impossible to miss, and neither of those is
 * the same thing as being fast.
 *
 * So moving between tabs now says nothing at all. The navigation items are real
 * links, which means App Router has the next screen's payload in hand before the
 * click, and each screen keeps the inline skeletons it already had for data that
 * genuinely has not arrived. What is left is a move that either happens instantly
 * or shows the real shape of the page loading into it.
 *
 * Sign-out stays, because it is a different thing: the session is ending, the
 * screen is about to be destroyed by a full document load, and an officer who has
 * just asked to leave deserves to be told the platform heard them rather than
 * watching the page quietly change underneath them.
 *
 * It also stands down whenever the branded post-sign-in screen is up, so the two
 * full-screen loaders can never stack.
 */
export function PlatformPageLoader() {
  return (
    <Suspense fallback={null}>
      <PlatformPageLoaderInner />
    </Suspense>
  );
}

function PlatformPageLoaderInner() {
  const [visible, setVisible] = useState(false);
  const handover = useRef(false);
  const [, forceHandoverCheck] = useState(0);

  useEffect(
    () =>
      onHandoverChange(active => {
        handover.current = active;
        // Re-render so the element below reflects it. The state is otherwise
        // driven by the sign-out event, and a sibling changing state would
        // otherwise go unnoticed here.
        forceHandoverCheck(n => n + 1);
        if (active) setVisible(false);
      }),
    []
  );

  useEffect(
    () =>
      onSignOut(() => {
        // The branded screen outranks this one, whatever order they arrive in.
        if (handover.current) return;
        setVisible(true);
      }),
    []
  );

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <PageLoader />
    </div>
  );
}
