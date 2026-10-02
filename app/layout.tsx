import type { Metadata, Viewport } from "next";
import appLogo from "@assets/brand/app-logo.webp";
import { DM_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { AppErrorBoundary } from "./error-boundary";
import { NavigationProgress } from "@/components/NavigationProgress";
import { PostSignInGate } from "@/components/PostSignInGate";
import "@/index.css";

/**
 * The typeface every screen is set in.
 *
 * `index.css` has always asked for DM Sans by name, but nothing ever loaded it,
 * so the whole application was silently rendering in the system UI font and the
 * two never matched. `next/font` fetches it at build time and self-hosts the
 * result, so there is no third-party request at runtime and no layout shift from
 * a late swap — the variable it exposes is what `body` now reads.
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

/**
 * Fetch the mark before it is needed.
 *
 * The post-sign-in screen is drawn only after a credential is accepted, and the
 * mark is the one thing on it that cannot be drawn late — the ring assembles
 * itself over two seconds, and an empty circle for that two seconds is not a
 * loading state, it is a broken image. Without this the 40 KB fetch starts at the
 * moment the screen appears, on the same connection that is still carrying the
 * dashboard, so on a slow link the animation runs against nothing.
 *
 * So it is asked for here, on every page, where it costs one small request and
 * arrives long before it is looked at.
 *
 * `imageSizes` rather than a srcset, because this build serves the static import
 * unoptimised - the measured wire weight was 1.23 MB for the PNG this replaced -
 * so there is only ever one candidate and telling the browser the size it is
 * painted at is what stops it reserving the wrong box.
 */
export const appLogoPreload = {
  rel: "preload" as const,
  as: "image" as const,
  href: appLogo.src,
  imageSizes: "310px",
  fetchPriority: "high" as const,
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
    <html lang="en" className={dmSans.variable} suppressHydrationWarning>
      <body>
        <link {...appLogoPreload} />
        <AppErrorBoundary>
          {/* Above the tree so it survives a route that fails to render: the
              officer sees the bar and the error together, rather than a bar
              that stops because the screen it was heading for never arrived. */}
          <NavigationProgress />
          <Providers>
            {/*
             * Above the router, so the branded screen survives the navigation
             * that follows a sign-in. The dashboard is a Server Component and
             * takes seconds to arrive; without a screen of its own mounted
             * before that navigation starts, App Router's ordinary fallback
             * covers the wait and the officer sees a loader, then a logo, then
             * the platform.
             */}
            <PostSignInGate>{children}</PostSignInGate>
          </Providers>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
