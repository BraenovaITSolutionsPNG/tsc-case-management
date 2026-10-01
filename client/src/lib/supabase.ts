import { createBrowserClient } from "@supabase/ssr";
import { isSupabaseUrl, supabaseUrlFault } from "@shared/supabaseUrl";

/**
 * The browser's Supabase client.
 *
 * It is signed in as the officer, with the anon key, and it can read nothing
 * that row level security does not already permit. The service role key is never
 * imported here — a client bundle is public, and a key that bypasses RLS has no
 * business in one.
 *
 * Sign-in happens through this client so the session cookies are written by
 * @supabase/ssr, which is what the server reads back on the next request. The
 * alternative — posting the password to our own route — is what the app used to
 * do, and it meant this deployment held a copy of every officer's password.
 *
 * Reads go through `process.env` rather than a bare identifier because Next
 * replaces the literal member expression at build time; a destructured or
 * dynamic lookup would silently become undefined in the browser.
 */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client: ReturnType<typeof createBrowserClient> | null = null;

/**
 * False when this deployment was built without usable Supabase configuration.
 *
 * The sign-in screen checks this before offering a form, because a form that
 * cannot work is worse than an explanation. It is a build-time fact, so it does
 * not change while the page is open.
 *
 * "Usable" as well as "present", and for the same reason as the server's
 * equivalent in `server/_core/supabaseAuth.ts`: a build that inlined a mangled
 * project URL is not configured, however non-empty that URL is. Judged by the
 * shared check so the two ends cannot come to opposite conclusions about one
 * deployment.
 */
export const isSupabaseConfigured = Boolean(
  isSupabaseUrl(supabaseUrl) && supabaseAnonKey
);

/**
 * The singleton client, created on first use.
 *
 * Created lazily rather than at module scope because a module-scope client is
 * constructed during the server render of any page that imports this file, and
 * `createBrowserClient` has no server-side cookie jar to attach to.
 */
export function getSupabaseBrowserClient() {
  const urlFault = supabaseUrlFault(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL");
  if (urlFault) {
    throw new Error(urlFault);
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Supabase is not configured on this deployment. Sign-in is unavailable."
    );
  }
  if (!client) {
    client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return client;
}
