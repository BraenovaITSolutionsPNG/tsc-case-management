"use client";

import { useEffect } from "react";
import { ErrorCard } from "@/components/ErrorBoundary";

/**
 * The last line of defence: a failure in `app/layout.tsx` itself.
 *
 * Everything else in the error chain sits *below* the root layout, which means
 * none of them covers it. A failure in `<html>`, `<body>`, the font loader or
 * the providers App Router mounts before the tree is handed to a segment takes
 * the document down and Next.js substitutes its own page: unstyled, with no
 * brand, no way back into the platform and no error text an operator can use.
 *
 * That is the one failure an officer is guaranteed to see rather than one they
 * may see, which is why it gets the platform's own card instead of a default.
 *
 * The `html`/`body` tags are required rather than decorative. This boundary
 * replaces the root layout's output, so it has to supply the document
 * structure itself — and it cannot use `ThemeProvider`, which lives inside the
 * providers that may be what failed. Hence the inline colours: the card must be
 * legible whether the platform is in light or dark mode, without depending on
 * anything that might be the thing that broke.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global] root layout render failed:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-background text-foreground">
        <ErrorCard error={error} onRetry={reset} />
      </body>
    </html>
  );
}
