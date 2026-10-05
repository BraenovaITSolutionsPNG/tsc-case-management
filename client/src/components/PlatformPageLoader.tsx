"use client";

import { PageLoader } from "@/components/BrandLoader";
import { onSignOut } from "@/lib/signOut";
import { Suspense, useEffect, useState } from "react";

/**
 * The platform's own full-screen loader, for signing out.
 *
 * Sign-out is a different thing from every other move in the
 * platform: the session is ending, the screen is about to be
 * destroyed by a full document load, and an officer who has just
 * asked to leave deserves to be told the platform heard them
 * rather than watching the page quietly change underneath them.
 *
 * Moving between tabs says nothing at all, by contrast, and that
 * is deliberate. The navigation items are real links, which means
 * App Router has the next screen's payload in hand before the
 * click, and each screen keeps the inline skeletons it already
 * had for data that genuinely has not arrived. A full-screen
 * takeover is the most disruptive thing an interface can do, and
 * spending it on a move that takes a fraction of a second means
 * the officer's first impression of every other tab is a
 * takeover that has already gone — which is what made the tabs
 * read as slow. What is left is a move that either happens
 * instantly or shows the real shape of the page loading into it.
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

  useEffect(() => onSignOut(() => setVisible(true)), []);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[90]">
      <PageLoader />
    </div>
  );
}
