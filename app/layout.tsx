import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { AppErrorBoundary } from "./error-boundary";
import { PlatformPageLoader } from "@/components/PlatformPageLoader";
import { RouteProgressBar } from "@/components/RouteProgressBar";
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
  title: {
    default: "TSC Case Management",
    template: "%s | TSC Case Management",
  },
  description:
    "Provincial matters administration platform for the Papua New Guinea Teachers Service Commission. Manage case registers, referrals, escalations, reporting, and director briefings in one secure government system.",
  keywords: [
    "TSC",
    "Teachers Service Commission",
    "Papua New Guinea",
    "case management",
    "provincial matters",
    "education",
    "matter register",
    "government",
    "public service",
    "case register",
    "referrals",
    "director brief",
    "provincial administration",
    "PNG",
  ],
  authors: [
    { name: "Teachers Service Commission" },
    { name: "Provincial Matters Office" },
  ],
  creator: "Teachers Service Commission",
  publisher: "Teachers Service Commission",
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  category: "Government Administration",
  classification: "Official Government System",
  openGraph: {
    type: "website",
    locale: "en_PG",
    url: "/",
    title: "TSC Case Management",
    description:
      "Provincial matters administration platform for the Papua New Guinea Teachers Service Commission. Manage case registers, referrals, escalations, reporting, and director briefings.",
    siteName: "TSC Case Management",
  },
  twitter: {
    card: "summary_large_image",
    title: "TSC Case Management",
    description:
      "Provincial matters administration for the Papua New Guinea Teachers Service Commission.",
  },
  icons: {
    icon: [
      { url: "/tsc-logo.png", type: "image/png" },
    ],
    apple: [
      { url: "/tsc-logo.png", type: "image/png" },
    ],
    shortcut: ["/tsc-logo.png"],
  },
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
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
 * genuinely not arrived.
 *
 * What replaces it is `RouteProgressBar`: a two-pixel line across the top of
 * the screen that only appears once a navigation has outrun a short delay.
 * The two halves are the same decision taken twice. Most tab changes here
 * commit in well under the delay, because the payload is prefetched behind
 * the link, and the correct amount of feedback for a navigation that has
 * already finished is none. The one that does not is the one that needs to be
 * heard from — and it is told by an overlay rather than by a takeover, so it
 * costs nothing on the tabs that did not need it.
 *
 * The one wait a *full-screen* loader is kept for is the one after a sign-in,
 * which the sign-in screen itself draws until the navigation commits.
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
          {/* Alongside it rather than instead of it: this one is for a tab
              change that is slow, that one is for a session ending. Neither
              overlaps the other — the bar only follows a link click, and the
              sign-in and sign-out waits are both driven by `router` calls the
              bar deliberately ignores. */}
          <RouteProgressBar />
          <Providers>{children}</Providers>
        </AppErrorBoundary>
      </body>
    </html>
  );
}
