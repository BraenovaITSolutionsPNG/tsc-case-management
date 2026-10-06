"use client";

import { createRouteProgress, type RouteProgress } from "@/lib/routeProgress";
import { cn } from "@/lib/utils";
import { onRouteChange } from "@/lib/routeChange";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * A thin bar across the top of the screen, for a tab change that is taking
 * longer than a tab change should.
 *
 * Why this rather than a full-screen loader, which is what the platform used
 * to show on every navigation: the previous screen was torn down the instant
 * a navigation began, so a link that resolved in a fifth of a second still
 * cost a full-screen takeover and a blank frame on the way back in. That is
 * what made the tabs read as slow — the slow part was the loader, not the
 * navigation. See the note in `app/layout.tsx` for the decision to drop the
 * root `loading.tsx`.
 *
 * Why this rather than nothing: a link the officer clicks that produces no
 * visible change at all for two seconds is indistinguishable from a link that
 * is broken. The bar overlays the page rather than replacing it, so the
 * officer keeps the screen they were on, keeps their scroll position, and sees
 * only a two-pixel line at the top acknowledging the click.
 *
 * It is deliberately *late*. `SHOW_DELAY_MS` in `@/lib/routeProgress` is the
 * whole design, and the decision it encodes is the one this file exists to
 * serve: the
 * navigation items are real `<Link>`s, so App Router has the next screen's RSC
 * payload in hand before the click is even finished, and the overwhelming
 * majority of navigations commit well inside that window. Nothing is painted
 * for them, because the correct amount of feedback for a navigation that has
 * already finished is none. Only a navigation that outruns the delay says
 * anything.
 *
 * It hears about a navigation two ways, and both are needed. A click on a
 * `<Link>` is observable from the document, so it is read there — keyboard
 * activation included, since Enter does not fire a click. A `router.push` is
 * not observable at all, so the code that does it says so through
 * `useRouteNavigate`. Missing the second one was a real gap rather than a
 * theoretical one: the command palette, the case rows on the overview and the
 * jump to a just-registered matter all navigate that way, and they are the
 * heaviest navigations in the platform.
 *
 * What it deliberately does not cover is a redirect. Every `router.replace` in
 * this app is a bounce to the sign-in screen on an expired session, and a bar
 * drawn across the screen on the way out would be drawn over the message the
 * officer is being given. The one navigation that genuinely warrants a
 * full-screen takeover — the handover after a sign-in, which is waiting on a
 * cold server render — is drawn by the sign-in screen itself, which stays
 * mounted for exactly as long as the wait.
 */

/**
 * The internal link an event landed on, or null if this was not one.
 *
 * Every exclusion here is a case where no navigation follows, and showing a
 * progress bar for one would be a lie: a download, a link into another origin,
 * and a link that opens a new tab all leave this page exactly where it is.
 */
function internalLinkFrom(
  target: EventTarget | null
): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;

  const anchor = target.closest("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if (anchor.hasAttribute("download")) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  // A plain `#section` link, and a mailto: or tel: — all of which stay put.
  if (anchor.getAttribute("href")?.startsWith("#")) return null;

  let url: URL;
  try {
    url = new URL(anchor.href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  return anchor;
}

export function RouteProgressBar() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);

  /*
   * One controller for the whole component.
   *
   * `useRef` rather than `useState` for the instance, because the event
   * listeners below are registered once and must reach the same controller for
   * their whole life; recreating it on a render would strand the timers set up
   * by the previous one. The timing itself — when to paint, when to take down,
   * when to give up — lives in `createRouteProgress` and is tested there against
   * a fake clock. This component decides only *when a navigation is happening*,
   * which is the half that needs a DOM to answer.
   */
  const progressRef = useRef<RouteProgress | null>(null);
  progressRef.current ??= createRouteProgress(setVisible);

  // Bound once per render and never reassigned, so the closures below and the
  // effect's cleanup all reach the same controller.
  const progress = progressRef.current;

  useEffect(() => {
    const controller = progress;

    /**
     * The half that cannot be observed. Anything navigating through
     * `useRouteNavigate` announces itself here, because a `router.push` leaves no
     * trace a document listener could find — and the command palette, the case
     * rows on the overview and the jump to a newly registered matter all navigate
     * that way. They are the heavy navigations in the platform, so leaving them
     * unannounced would have been the worst of both worlds: a bar on the cheap
     * moves and silence on the ones worth showing it for.
     */
    const stop = onRouteChange(controller.begin);

    /** Whether a link goes somewhere else, rather than to the page already open. */
    function leavesThisPage(anchor: HTMLAnchorElement): boolean {
      const url = new URL(anchor.href, window.location.href);
      return (
        url.pathname !== window.location.pathname ||
        url.search !== window.location.search
      );
    }

    /**
     * Capture phase, so a listener further down cannot suppress this by calling
     * `preventDefault`. A navigation cancelled after that never changes the
     * pathname, and the controller's give-up window cleans up.
     */
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented) return;
      // Left click only, and no modifier: all of these either open a new tab or
      // mean the officer did not mean to navigate at all.
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;

      const anchor = internalLinkFrom(event.target);
      if (!anchor) return;

      // A link to the page already open navigates nowhere. Ending is what stops
      // an officer clicking back and forth between two tabs from leaving a bar
      // behind.
      if (!leavesThisPage(anchor)) {
        controller.end();
        return;
      }

      controller.begin();
    }

    // Enter on a focused link does not fire a click, so keyboard navigation would
    // otherwise get no bar at all — the officer using the keyboard would find the
    // platform feels slower than the one using the mouse.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || event.defaultPrevented) return;

      const anchor = internalLinkFrom(event.target);
      if (!anchor) return;

      if (!leavesThisPage(anchor)) {
        controller.end();
        return;
      }

      controller.begin();
    }

    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      stop();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown, true);
      // Timers outlive the component unless told otherwise, and one firing into a
      // component that has gone would be a leak rather than a message.
      controller.dispose();
    };
  }, [progress]);

  // The pathname changing is the only completion signal App Router offers here.
  useEffect(() => {
    progress.end();
  }, [pathname, progress]);

  return (
    // `role="progressbar"` with an indeterminate value rather than no role at
    // all: the bar is drawn for a navigation that has genuinely not finished,
    // so it is real progress information, and an officer on a screen reader is
    // owed the same "something is happening" the line gives everyone else.
    <div
      role="progressbar"
      aria-label="Loading the next screen"
      aria-busy={visible}
      // `pointer-events-none` so the two pixels across the top of the screen
      // cannot intercept a click meant for the interface underneath it. Left
      // mounted and faded rather than removed when idle, so an appearance is a
      // fade and not a bar materialising out of nothing.
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0"
      )}
    >
      <div className="animate-loader-bar h-full w-1/3 bg-teal-700" />
    </div>
  );
}
