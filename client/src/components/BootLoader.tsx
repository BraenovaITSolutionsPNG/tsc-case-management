"use client";

import appLogo from "@assets/brand/app-logo.webp";
import Image from "next/image";
import { useEffect } from "react";

/**
 * The branded screen shown once, after a successful sign-in and before the
 * platform appears.
 *
 * Two things it is deliberately not. It is not a progress bar that means
 * anything: nothing here reports how much of the platform is ready, because
 * nothing knows. And it is not shown on ordinary navigation — the session is
 * already resolved then, so the skeleton the layout already had is both faster
 * and quieter, and replacing it with a celebration on every page change would
 * make the app slower to use in exchange for looking good once.
 *
 * The animation is the design from `assets/Logo_Loader`, ported rather than
 * reinvented: the mark assembling inside its ring, then the words, then the
 * bar. Its styles live in `index.css` under a `boot-` prefix, because the
 * keyframes and the pseudo-element layers are too entangled for utility classes
 * to carry without becoming unreadable.
 *
 * `minimumVisibleMs` is the part that matters for correctness. The screen is
 * shown because signing in is a moment worth marking, and a mark that flashes
 * for 200ms reads as a glitch rather than as a moment — so it is held for a
 * floor as well as released as soon as the session resolves. The caller
 * unmounts it when the platform is ready; this reports when the floor has passed
 * so the caller can do that no earlier.
 *
 * Honours `prefers-reduced-motion`: the ring stops turning and the bar sits
 * part-filled. A person who has asked the system to stop moving things is not
 * served by an animation, however well made it is.
 */
export function BootLoader({
  minimumVisibleMs = 2000,
  onMinimumElapsed,
  fading = false,
}: {
  minimumVisibleMs?: number;
  onMinimumElapsed?: () => void;
  /**
   * Fade the screen out rather than holding it opaque.
   *
   * Set once the platform is ready and rendered underneath, so the two overlap
   * for the length of the fade and neither arrives as a cut. The element stays
   * mounted throughout — the caller unmounts it on a timer matching
   * `BOOT_FADE_MS` — and stops taking pointer events while it is on its way out,
   * so a click landing in those last few hundred milliseconds reaches the
   * platform instead of being swallowed by a screen that is leaving.
   */
  fading?: boolean;
}) {
  useEffect(() => {
    if (!onMinimumElapsed) return;
    const timer = setTimeout(onMinimumElapsed, minimumVisibleMs);
    // Cleared on unmount, so a sign-in that is interrupted mid-count cannot
    // call back into a component that is no longer there.
    return () => clearTimeout(timer);
  }, [onMinimumElapsed, minimumVisibleMs]);

  return (
    <div
      className={fading ? "boot-shell boot-shell-fading" : "boot-shell"}
      role="status"
      aria-live="polite"
      aria-label="Signing you in"
      // The screen is on its way out; the platform beneath it is the thing being
      // read now, and a status region mid-fade would keep announcing itself over
      // the officer's first screen of the platform.
      aria-hidden={fading || undefined}
    >
      <div className="boot-ambient boot-ambient-one" />
      <div className="boot-ambient boot-ambient-two" />
      <div className="boot-grain" />

      <div className="boot-card">
        <div className="boot-monogram-stage">
          <span className="boot-monogram-pulse" />
          <Image
            className="boot-monogram"
            src={appLogo}
            alt=""
            width={310}
            height={310}
            // The mark is the point of the screen, and it is the one thing that
            // cannot be drawn late without the whole thing looking empty for a
            // beat. `priority` also stops the browser treating it as lazy on a
            // navigation that exists only to show it.
            priority
            sizes="310px"
          />
        </div>

        <div className="boot-copy">
          <p className="boot-eyebrow">A journey is beginning</p>
          <h1 className="boot-title">Preparing your experience</h1>
        </div>

        <div
          className="boot-progress"
          role="progressbar"
          aria-label="Loading"
          aria-valuetext="Loading"
        >
          <span className="boot-progress-fill" />
          <span className="boot-progress-shimmer" />
        </div>

        <div className="boot-caption" aria-hidden="true">
          <span>Loading</span>
          <span className="boot-dots">
            <i />
            <i />
            <i />
          </span>
        </div>
      </div>
    </div>
  );
}
