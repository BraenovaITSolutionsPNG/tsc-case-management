import type { Metadata, Viewport } from "next";
import { DM_Sans } from "next/font/google";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import { AppErrorBoundary } from "./error-boundary";
import { NavigationProgress } from "@/components/NavigationProgress";
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
