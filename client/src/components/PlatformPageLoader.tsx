"use client";

import { PageLoader } from "@/components/BrandLoader";
import { onHandoverChange, onSignOut } from "@/lib/postSignIn";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * The platform's own full-screen loader, for moving around inside it.
 *
 * This is the original loader — the ring, the arc and the case file — put back
 * where it used to be, covering the two things an officer does once they are in:
 * moving between the tabs, and signing out. Until now the tabs showed only a thin
 * bar along the top, which is easy to miss on a machine that is also doing
 * something else, and signing out showed the layout's grey skeleton — a page of
 * grey boxes standing in for a screen they had just asked to leave.
 *
 * Three rules keep it from becoming the thing it is replacing:
 *
 *  - It never appears during a post-sign-in handover. That screen is the one
 *    moment with a deliberate piece of theatre, and two full-screen loaders
 *    stacking on each other is the sequence this app has been trying to get rid
 *    of. The gate publishes when it is up and this stands down.
 *  - It is never shown for an instant. A takeover that flashes for 50ms is worse
 *    than no takeover at all, so it appears only once a move has been running
 *    long enough to be worth covering, and then stays at least that long.
 *  - It covers nothing once the move is done, and always comes down.
 */
export function PlatformPageLoader() {
  return (
    <Suspense fallback={null}>
      <PlatformPageLoaderInner />
    </Suspense>
  );
}

function PlatformPageLoaderInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [visible, setVisible] = useState(false);
  // The route this loader last settled on. A change is what counts as a move; a
  // first render is not one, or every page load would show a takeover.
  const settled = useRef(`${pathname}?${searchParams.toString()}`);
  const shownAt = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handover = useRef(false);
  const [, forceHandoverCheck] = useState(0);

  useEffect(
    () =>
      onHandoverChange(active => {
        handover.current = active;
        // Re-render so the element below reflects it; the loader is driven by
        // timers otherwise and would not notice a sibling's state changing.
        forceHandoverCheck(n => n + 1);
        if (active) setVisible(false);
      }),
    []
  );

  useEffect(() => onSignOut(() => setVisible(true)), []);

  useEffect(() => {
    const current = `${pathname}?${searchParams.toString()}`;
    if (current === settled.current) return;
    settled.current = current;

    if (handover.current) return;

    // Only once the move has been running long enough to be worth covering.
    showTimer.current = setTimeout(() => {
      shownAt.current = Date.now();
      setVisible(true);
    }, MOVE_THRESHOLD_MS);

    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
    };
  }, [pathname, searchParams]);

  // Hides once the move is over, but never sooner than the loader has been up
  // long enough to read as feedback rather than a flicker.
  useEffect(() => {
    if (!visible) return;

    const settle = setTimeout(() => {
      const heldFor = Date.now() - shownAt.current;
      const remaining = Math.max(0, MIN_VISIBLE_MS - heldFor);
      hideTimer.current = setTimeout(() => setVisible(false), remaining);
    }, SETTLE_MS);

    return () => {
      clearTimeout(settle);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <PageLoader />
    </div>
  );
}

/**
 * How long a move must be running before the takeover appears.
 *
 * Below this, a full-screen loader is a flash: the officer sees a white screen
 * with a spinner that has already gone by the time they read it. Above it, the
 * move is slow enough that being told so is a kindness.
 */
const MOVE_THRESHOLD_MS = 140;

/** How long before the route has settled to conclude that the move is over. */
const SETTLE_MS = 60;

/**
 * How long the loader is held once it appears, so it is never a flicker.
 *
 * The same reasoning as the bar this replaces, which used 320ms. Kept identical
 * so a move that used to draw a brief bar now draws a brief takeover rather than
 * a longer one: the officer has learned that length already.
 */
const MIN_VISIBLE_MS = 320;
