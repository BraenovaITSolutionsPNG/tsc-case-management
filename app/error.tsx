"use client";

import { useEffect } from "react";
import { ErrorCard } from "@/components/ErrorBoundary";

/**
 * The error surface App Router uses for a render failure inside a route.
 *
 * `app/error.tsx` is only rendered for errors thrown while a page renders, so
 * this presents the app's own recovery card rather than the platform's
 * unstyled "Application error boundary" page, which offers no context and no
 * way back.
 */
export default function AppRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Route] render failed:", error);
  }, [error]);

  return <ErrorCard error={error} onRetry={reset} />;
}
