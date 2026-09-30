import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { AppErrorBoundary } from "./error-boundary";
import { NavigationProgress } from "@/components/NavigationProgress";
import "@/index.css";

export const metadata: Metadata = {
  title: "TSC Case Management",
  description:
    "Provincial matters administration for the Kenya Teachers Service Commission.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

/**
 * The document shell.
 *
 * This is the file Vite's `client/index.html` used to be: everything that
 * wraps a single page regardless of which route is active now lives here, and
 * per-route chrome belongs in a nested layout instead.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <AppErrorBoundary>
          {/* Above the tree so it survives a route that fails to render: the
              officer sees the bar and the error together, rather than a bar
              that stops because the screen it was heading for never arrived. */}
          <NavigationProgress />
          <Providers>{children}</Providers>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
