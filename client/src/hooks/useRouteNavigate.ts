"use client";

import { beginRouteChange } from "@/lib/routeChange";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

/**
 * Navigation that announces itself, for the routes a `<Link>` cannot cover.
 *
 * The sidebar and the buttons are real links, and `RouteProgressBar` sees those
 * by listening to the document. Three navigations are not links:
 *
 *  - the command palette (⌘K), which is a list of routes rather than a list of
 *    anchors;
 *  - a case row on the overview, which is a click on a matter rather than on a
 *    URL;
 *  - the jump to a matter that has just been registered.
 *
 * All three reach for `router.push` directly, which raises nothing — so they
 * navigated with no indicator at all, and they are the *heavy* ones: each opens a
 * server-rendered screen that reads a matter. The bar existed and was silent for
 * precisely the waits it was written for.
 *
 * So a navigation is now one helper rather than two habits. Calling this instead
 * of `router.push` is the whole of the difference between a screen that announces
 * its own load and one that appears from nowhere; the signal is raised first, so
 * the bar's delay starts at the click rather than a frame later.
 *
 * Only `push`. `router.replace` is not wrapped on purpose: every `replace` in
 * this app is a bounce to the sign-in screen on an expired session, and a
 * progress bar drawn on the way out would be drawn over the message the officer
 * is being given.
 */
export function useRouteNavigate(): (href: string) => void {
  const router = useRouter();

  return useCallback(
    (href: string) => {
      beginRouteChange();
      router.push(href);
    },
    [router]
  );
}
