import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Enterprise security headers applied to every HTML response.
 *
 * These are the minimum set an internal government system should carry.
 * Content-Security-Policy is deliberately omitted: the inline styles
 * used by Tailwind v4 and the client bundle's own boot script both
 * require `unsafe-inline`, which defeats the policy's purpose. A
 * production deployment should set CSP at the reverse proxy or CDN,
 * where it can be tuned to the actual script and style sources.
 */

export function proxy(request: NextRequest) {
  const response = NextResponse.next();

  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
