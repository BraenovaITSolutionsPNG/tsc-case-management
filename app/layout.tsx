import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { AppErrorBoundary } from "./error-boundary";
import { PlatformPageLoader } from "@/components/PlatformPageLoader";
import "@/index.css";

/**
 * The typeface every screen is set in.
 *
 * `index.css` has always asked for DM Sans by name, but nothing ever
 * loaded it, so the whole application was silently rendering in the
 * system UI font and the two never matched. `next/font` fetches it at
 * build time and self-hosts the result, so there is no third-party
 * request at runtime and no layout shift from a late swap — the
 * variable it exposes is what `body` now reads.
 */
const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

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
 *
 * There is deliberately no `loading.tsx` at the app root. A loading
 * boundary swaps the page the officer is on for a full-screen loader the
 * moment any navigation starts, which made every tab change read as a slow
 * load — the tabs that took a fraction of a second included. Without one,
 * the current screen stays up until the next one's paint commits, the
 * navigation items have already prefetched the payload behind each link,
 * and each screen keeps the inline skeletons it has for data that has
 * genuinely not arrived. The one wait a loader is kept for is the one
 * after a sign-in, which the sign-in screen itself draws until the
 * navigation commits.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <body>
        <AppErrorBoundary>
          {/* Above the tree so it survives a route that fails to render: the
              officer sees the bar and the error together, rather than a bar
              that stops because the screen it was heading for never arrived. */}
          <PlatformPageLoader />
          <Providers>{children}</Providers>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
