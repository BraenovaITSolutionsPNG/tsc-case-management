/**
 * Supabase clients.
 *
 * Supabase owns credentials and sessions. It does NOT own roles: the five TSC
 * tiers and the fifteen capabilities are defined in shared/roles.ts and
 * shared/access.ts and mirrored into the app's own `users` table, because a
 * capability check that has to leave the process to answer is a capability check
 * that can be stale, and the accountability trail for a disciplinary matter
 * should not depend on a token claim.
 *
 * Three clients, because there are three distinct jobs and confusing them is
 * how a service key leaks into a browser bundle:
 *
 *  - `createServerClient` — reads the session cookie out of the request. The
 *    user's own privileges only: it is RLS-scoped and safe anywhere.
 *  - `createAdminClient` — the service role. Bypasses RLS entirely. Server
 *    only, never returned to the browser, and only for the two operations that
 *    cannot be done as a user: creating an account, and reading a password
 *    reset link.
 *  - `createBrowserClient` — the anon key, for the sign-in form.
 */

import { cookies } from "next/headers";
import { createServerClient as createSupabaseServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { ENV } from "./env";

/**
 * Whether this deployment has been given Supabase at all.
 *
 * Read by the sign-in screen and by the session bridge. A deployment with no
 * Supabase configuration is a misconfiguration, not a mode to degrade into: the
 * app's own session cookie would then be the only thing standing between an
 * anonymous visitor and the case register. So the answer is reported rather
 * than substituted, and the caller decides what to do about it.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(ENV.supabaseUrl && ENV.supabaseAnonKey);
}

export function isSupabaseAdminConfigured(): boolean {
  return Boolean(ENV.supabaseUrl && ENV.supabaseServiceRoleKey);
}

/**
 * The public half of the configuration. Safe to hand to the browser: both
 * values are public by design in Supabase and are gated by row level security,
 * which is what actually protects the data.
 *
 * Throws rather than returning undefined, because a caller that inlined
 * `undefined` into a bundle would ship a broken client and fail at runtime in
 * the browser, where the cause is not visible. Failing here names it.
 *
 * The second throw is the one that saves an afternoon. The browser bundle was
 * compiled with whatever `NEXT_PUBLIC_SUPABASE_*` held at build time, and this
 * function is reading the server's answer. If the two disagree the browser is
 * signing in against a different Supabase project from the one this process
 * looks the officer up in — and every symptom points the wrong way: a correct
 * password refused, a session that resolves to no row, an error about
 * credentials on an account that plainly exists. So it is refused here, by name,
 * instead.
 */
export function supabasePublicConfig(): { url: string; anonKey: string } {
  if (!isSupabaseConfigured()) {
    throw new Error(
      "Supabase is not configured on this deployment. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL and SUPABASE_ANON_KEY) — without them there is nowhere to sign in against."
    );
  }
  const { publicSupabaseUrl, publicSupabaseAnonKey } = ENV;
  // Only a real disagreement is an error. A deployment that supplies only one
  // of the two names has no disagreement to detect, and the fallback in env.ts
  // has already reconciled them.
  if (publicSupabaseUrl && publicSupabaseUrl !== ENV.supabaseUrl) {
    throw new Error(
      `Supabase is configured twice with different projects. The browser bundle was built with NEXT_PUBLIC_SUPABASE_URL=${publicSupabaseUrl} but this process reads SUPABASE_URL=${ENV.supabaseUrl}. Sign-in cannot work until they are the same project.`
    );
  }
  if (publicSupabaseAnonKey && publicSupabaseAnonKey !== ENV.supabaseAnonKey) {
    throw new Error(
      "Supabase is configured twice with different anon keys. The browser bundle was built with a different NEXT_PUBLIC_SUPABASE_ANON_KEY than the SUPABASE_ANON_KEY this process reads."
    );
  }
  return { url: ENV.supabaseUrl, anonKey: ENV.supabaseAnonKey };
}

/**
 * A Supabase client bound to the caller's own session, for use inside a request.
 *
 * @supabase/ssr's cookie adapter is what makes this work from a Server
 * Component or a route handler: it reads the session cookie Supabase's client
 * wrote on sign-in, and a refreshed access token is written back through the
 * same adapter so the browser keeps a valid session without the app handling a
 * token itself.
 *
 * Note what this app no longer does: it does not sign, verify or refresh a JWT.
 * `JWT_SECRET` and the `app_session_id` cookie belong to the previous
 * arrangement and are gone.
 */
export async function createServerClient() {
  const { url, anonKey } = supabasePublicConfig();
  const cookieStore = await cookies();

  return createSupabaseServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot set cookies. This is expected and not an
          // error: it happens when a session is refreshed while a Server
          // Component renders. The refreshed token is persisted by the route
          // handler or middleware that handles the next mutation, so the
          // session survives; swallowing it here keeps a normal page render
          // from throwing.
        }
      },
    },
  });
}

/**
 * The service-role client: full access, no RLS, no user session.
 *
 * Server-only, and gated on the key being present so a development machine
 * without it gets a named error instead of a request signed with an empty key.
 *
 * Two callers, both of which are administrator actions in `server/routers.ts`:
 * creating an account, and asking Supabase for a password-reset link. Reading
 * a password never happens here — Supabase does not disclose hashes, and cannot
 * be made to.
 */
export function createAdminClient() {
  if (!isSupabaseAdminConfigured()) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set on this deployment. Administrator features that create or recover an account need it."
    );
  }
  return createClient(ENV.supabaseUrl, ENV.supabaseServiceRoleKey, {
    auth: {
      // The service role is not a user session and must never be persisted or
      // refreshed: it would be stored where a user token belongs.
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
