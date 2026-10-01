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
 * Why this build has no sign-in, in words, or `null` when it does.
 *
 * `isSupabaseConfigured` is a boolean, and a boolean on the sign-in screen
 * leaves the operator with "tell the platform administrator" and nothing else —
 * which is what a build-time fault usually needs, because the fault is a
 * misconfiguration only the operator can fix and there is no other place it will
 * surface. `/login` is prerendered, so this is decided once, when the bundle was
 * compiled, and the only evidence the build produced is this page.
 *
 * Deliberately a description of the *build*, never of a visitor. Nothing here
 * varies per request and nothing here is about the account in front of the
 * screen: it reports which variables this bundle was compiled with, which is a
 * fact about the deployment and is not derived from anything anybody submitted.
 *
 * Safe to render, then, with one exception kept below: the anon key is reported
 * as present or absent and its value is never printed. The URL needs printing —
 * a mangled one cannot be recognised as mangled without seeing it — and that is
 * no disclosure, since the value is already in this bundle for anyone who opens
 * the developer tools to look. The key is printed for nobody.
 */
function describeSupabaseBuildFault(): string | null {
  const faults: string[] = [];

  const urlFault = supabaseUrlFault(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL");
  if (urlFault) {
    faults.push(urlFault);
  } else if (!supabaseUrl) {
    faults.push(
      "NEXT_PUBLIC_SUPABASE_URL is not set on this deployment. It was not set when this page was built, and a page that is already built cannot be given it."
    );
  }

  if (!supabaseAnonKey) {
    faults.push(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set on this deployment, so the browser has nothing to sign in with."
    );
  }

  return faults.length ? faults.join(" ") : null;
}

export const supabaseBuildFault = describeSupabaseBuildFault();

/**
 * The singleton client, created on first use.
 *
 * Created lazily rather than at module scope because a module-scope client is
 * constructed during the server render of any page that imports this file, and
 * `createBrowserClient` has no server-side cookie jar to attach to.
 */
export function getSupabaseBrowserClient() {
  // The same description the sign-in screen shows, so a caller that trips over
  // this from somewhere else gets the same words rather than a second, thinner
  // version of them.
  if (supabaseBuildFault) {
    throw new Error(supabaseBuildFault);
  }
  if (!supabaseUrl || !supabaseAnonKey) {
    // `supabaseBuildFault` already covers a missing value, so this branch does
    // not describe a third failure. It is here to narrow the two constants for
    // TypeScript, which cannot see that the description above rules it out.
    throw new Error(
      "Supabase is not configured on this deployment. Sign-in is unavailable."
    );
  }
  if (!client) {
    client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return client;
}
