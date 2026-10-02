"use client";

import { cn } from "@/lib/utils";

/**
 * The platform's loading animation.
 *
 * A spinner says "something is happening". This says what: a ring being drawn,
 * an arc travelling around it, and three rules filling in sequence — a matter
 * being taken in and worked. That is the thing an officer is waiting for, so
 * the animation is the honest one rather than a generic gear.
 *
 * Three things it deliberately is not:
 *
 *  - Not indeterminate-length. There is no fake percentage. The ring is a
 *    progress cycle, not a count, because the app cannot know how much is left.
 *  - Not blocking. `PageLoader` covers the viewport; `InlineLoader` sits in a
 *    button. Same mark, two jobs.
 *  - Not motion the reader did not ask for. Every animation is a keyframe that
 *    `prefers-reduced-motion` switches off, leaving a static "in progress" pose
 *    in its place (see index.css) — because a frozen spinner reads as a dead
 *    page, which is the opposite of the message.
 */

/** The mark itself, sized by the parent. Decorative; the label is the message. */
function LoaderMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={cn("h-10 w-10", className)}
      aria-hidden
      focusable="false"
    >
      {/* The drawn ring: 2πr ≈ 176 units of circumference at r=28, which is the
          dash length the keyframes animate. Kept as a constant in the CSS so
          the stroke and the animation cannot drift apart. */}
      <circle
        cx="32"
        cy="32"
        r="28"
        stroke="currentColor"
        strokeOpacity="0.15"
        strokeWidth="3"
      />
      <circle
        cx="32"
        cy="32"
        r="28"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="animate-loader-ring"
        transform="rotate(-90 32 32)"
      />

      {/* The sweeping arc, in the accent: a second hand over the first, so the
          two motions read as related rather than as two competing spinners. */}
      <g className="animate-loader-arc">
        <circle
          cx="32"
          cy="32"
          r="20"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="14 112"
          strokeOpacity="0.55"
        />
      </g>

      {/* The case file: three rules filling one after another. */}
      <g className="text-current">
        <rect
          x="24"
          y="25"
          width="16"
          height="2.5"
          rx="1.25"
          className="animate-loader-cascade"
        />
        <rect
          x="24"
          y="30.75"
          width="16"
          height="2.5"
          rx="1.25"
          className="animate-loader-cascade"
          style={{ animationDelay: "0.18s" }}
        />
        <rect
          x="24"
          y="36.5"
          width="10"
          height="2.5"
          rx="1.25"
          className="animate-loader-cascade"
          style={{ animationDelay: "0.36s" }}
        />
      </g>
    </svg>
  );
}

/**
 * A full-viewport loader, for a page that is loading for the first time.
 *
 * The mark is announced once, politely, rather than on a timer: a screen reader
 * user should be told the page is loading, and then told when it has, without
 * being interrupted by it.
 */
export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-screen flex-col items-center justify-center gap-5 bg-slate-50 px-6"
    >
      <LoaderMark className="h-16 w-16 text-teal-700" />
      <p className="text-sm font-medium tracking-wide text-slate-500">
        {label}
      </p>
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** The mark in place, for a button or a panel that is waiting on something. */
export function InlineLoader({ className }: { className?: string }) {
  return (
    <span role="status" className={cn("inline-flex", className)}>
      <LoaderMark className="h-5 w-5" />
      <span className="sr-only">Loading</span>
    </span>
  );
}
