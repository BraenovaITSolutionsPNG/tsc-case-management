import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Supabase auth cookie refresh + enterprise security headers.
 *
 * @supabase/ssr REQUIRES this middleware to refresh the auth cookie on every
 * request. Without it, the session cookie expires silently and the server
 * cannot read the user's identity, causing redirect loops like:
 * / (dashboard) -> /login (server thinks no session) -> / (login page finds session) -> / -> ...
 *
 * The cookie adapter reads the session cookie from the request and writes back
 * any refreshed token so the browser keeps a valid session.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export async function proxy(request: NextRequest) {
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

  // Critical: refresh session cookie on every request
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