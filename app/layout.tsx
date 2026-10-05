import type { Metadata, Viewport } from "next";
import appLogo from "@assets/brand/app-logo.webp";
import { DM_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { AppErrorBoundary } from "./error-boundary";
import { PlatformPageLoader } from "@/components/PlatformPageLoader";
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
 * The branded post-sign-in screen — currently disabled, see
 * `PostSignInGate` — is the only thing that draws the mark at
 * size, and the mark is the one thing on it that cannot be drawn
 * late: the ring assembles itself over two seconds, and an empty
 * circle for those two seconds is not a loading state, it is a
 * broken image. The preload stays while the screen is away so
 * that its return is a decision in the sign-in screen alone; it
 * costs one small request on every page and arrives long before
 * it is looked at.
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
          {/*
           * The platform's own loader, for moving between the tabs and signing
           * out. It was a thin bar until now, which is easy to miss, and a
           * skeleton on sign-out, which stood in for a screen the officer had
           * just asked to leave. It stands down whenever the branded post-sign-in
           * screen is up, so the two never stack.
           */}
          <PlatformPageLoader />
          <Providers>
            {/*
             * Above the router. It drew the branded screen between a
             * sign-in and the platform until that screen was disabled on
             * 2026-10-05 — on a slow round trip it came down before the
             * platform had arrived and the officer was shown a second
             * loading state after the logo. It stays mounted for the note
             * it consumes, and so the screen's return is a change in the
             * sign-in screen alone.
             */}
            <PostSignInGate>{children}</PostSignInGate>
          </Providers>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
