"use client";

import ErrorBoundary from "@/components/ErrorBoundary";

/**
 * The root error boundary, in the shape App Router needs it.
 *
 * App Router keeps its own boundary for errors thrown during a route render and
 * routes them to `app/error.tsx`. This one is deliberately mounted by hand in
 * the root layout instead, because it has to sit *inside* the providers: a
 * render error in any provider would otherwise take down the whole document,
 * where the old `createRoot` tree caught it and showed the recovery card.
 */
export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
