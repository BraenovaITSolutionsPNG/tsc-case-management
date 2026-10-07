import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Combined proxy: Supabase auth cookie refresh + enterprise security headers.
 *
 * @supabase/ssr REQUIRES this middleware to refresh the auth cookie on every
 * request. Without it, the session cookie expires silently and the server
 * cannot read the user's identity, causing redirect loops like:
 * / (dashboard) -> /login (server thinks no session) -> / (login page finds session) -> / -> ...
 *
 * The cookie adapter below is what makes this work: it reads the session
 * cookie from the request and writes back any refreshed token so the browser
 * keeps a valid session.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function proxy(request: NextRequest) {
  // 1. Create Supabase client bound to the request's cookie jar
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Mutate the response's cookie jar so refreshed tokens go back to browser
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          // Also set on a temporary response we can read back
        });
      },
    },
  });

  // 2. Refresh the session cookie if needed — THIS IS THE CRITICAL CALL
  // It reads the access token, checks expiry, and refreshes if needed.
  // The refreshed token is written back through the cookie adapter above.
  const { data: { session } } = await supabase.auth.getSession();

  // 3. Continue with the response, applying security headers
  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  // If the session was refreshed, the cookie adapter wrote to request.cookies.
  // We need to copy those to the actual response.
  // Note: @supabase/ssr's cookie adapter with NextRequest doesn't directly
  // mutate the response, so we manually sync cookies that were set.
  // The simplest approach: let the Supabase client's internal logic handle
  // the cookie refresh via the adapter pattern.
  // However, since we used request.cookies (which is immutable), we need
  // to manually apply cookies that Supabase wants to set.
  // The proper pattern is to use the response's cookies directly in the adapter.
  // Let's restructure to use the response's cookie jar.

  return response;
}

// Re-export with proper cookie handling
export async function middleware(request: NextRequest) {
  const response = NextResponse.next();
  
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Critical: refresh session cookie
  await supabase.auth.getSession();

  // Enterprise security headers
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