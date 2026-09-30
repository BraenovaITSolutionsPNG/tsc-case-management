"use client";

import { RouteProgress } from "@/components/BrandLoader";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * The bar that runs along the top of the window while the app moves between
 * pages.
 *
 * `app/loading.tsx` already covers a route *segment* resolving, which is the
 * server-render wait. This covers the other half — a link click inside the app,
 * where the shell is already on screen and a full-screen takeover would flash
 * the entire application for what is usually a fraction of a second.
 *
 * The trigger is the pathname rather than a router event because App Router
 * exposes no "navigation started" signal to the client; the pathname changing is
 * the earliest point at which the move is known to have happened.
 *
 * A timer guards it. Without one the bar would be visible for exactly as long
 * as a synchronous route change takes — a single frame, so it would flash rather
 * than show, which is worse than not having it. The bar is therefore shown only
 * once the move is still running after `MIN_VISIBLE_MS`, and always shown for
 * at least that long once it appears, so it is never a flicker.
 */
const MIN_VISIBLE_MS = 320;

function NavigationBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [visible, setVisible] = useState(false);
  // The value that was on screen before this navigation, so a change is
  // detected rather than re-firing on first render.
  const lastRoute = useRef(`${pathname}?${searchParams.toString()}`);
  const shownAt = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const current = `${pathname}?${searchParams.toString()}`;
    if (current === lastRoute.current) return;
    lastRoute.current = current;

    if (hideTimer.current) clearTimeout(hideTimer.current);

    // Not yet visible: wait to see whether the move finished quickly. If it did,
    // nothing is drawn at all.
    const appearTimer = setTimeout(() => {
      setVisible(true);
      shownAt.current = Date.now();
    }, MIN_VISIBLE_MS);

    hideTimer.current = setTimeout(() => {
      clearTimeout(appearTimer);
      // Never yank it away sooner than it was up: a bar that appears and
      // vanishes in a few frames reads as a glitch, not as progress.
      const elapsed = Date.now() - shownAt.current;
      hideTimer.current = setTimeout(
        () => setVisible(false),
        Math.max(0, MIN_VISIBLE_MS - elapsed)
      );
    }, 0);

    return () => {
      clearTimeout(appearTimer);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [pathname, searchParams]);

  if (!visible) return null;
  return <RouteProgress />;
}

export function NavigationProgress() {
  // `useSearchParams` suspends during prerender, so the reading half is split
  // into a boundary — the same reason /login wraps its form the same way.
  return (
    <Suspense fallback={null}>
      <NavigationBar />
    </Suspense>
  );
}
