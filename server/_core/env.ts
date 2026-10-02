/**
 * Where this deployment's configuration comes from, read once at import.
 *
 * The authentication half of this file is the part worth reading: Supabase owns
 * credentials and sessions, and this deployment holds no signing key of its own.
 * The app used to mint and verify its own session cookie from `JWT_SECRET`,
 * which meant the ability to authenticate anybody sat in this codebase. It now
 * asks Supabase who the caller is.
 */

/**
 * The project URL, from whichever name it was supplied under.
 *
 * Two names, and they are not redundant. `NEXT_PUBLIC_SUPABASE_URL` is the one
 * the browser bundle reads (`client/src/lib/supabase.ts`), and Next inlines it
 * at *build* time. `SUPABASE_URL` is the server-side reading of the same value,
 * settable at *run* time. So the two names answer different questions — "what
 * was the browser built with" and "what does this process talk to" — and a
 * deployment can legitimately answer them from different environment variables.
 *
 * They must not answer them *differently*, though: a server on one project with
 * a browser built for another produces a sign-in form that submits to a project
 * that has no such user, and the failure surfaces as "invalid login
 * credentials" for an officer who typed them correctly.
 *
 * So the server's own name wins here and the browser's is kept separately, which
 * is what makes that disagreement detectable at all. The order matters: had the
 * browser's name been preferred, this value would always equal the browser's and
 * the check in `supabasePublicConfig` could never fire — a guard that looks
 * present and is not worse than none, because it is read as covered.
 *
 * The trailing-slash trim is because Supabase's dashboard copies the URL with
 * one and without, and both appear in connection strings people paste.
 */
const supabaseUrl = (
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ""
).replace(/\/+$/, "");

const supabaseAnonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "";

export const ENV = {
  appId: process.env.NEXT_PUBLIC_APP_ID ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  isProduction: process.env.NODE_ENV === "production",

  /**
   * The anon key is public by design — it is meant to reach the browser, and it
   * is what row level security is there to constrain. The service role key is
   * the opposite: it bypasses RLS entirely, so it is never given the
   * `NEXT_PUBLIC_` prefix that would inline it into a bundle anyone can
   * download, and is passed only to `createAdminClient`.
   *
   * Neither is a credential in the sense of being secret, and neither should be
   * treated as one in a `.env` that is excluded from git anyway: the thing that
   * must not leak is the *service* key, and it is the only one of the three
   * without a public prefix.
   */
  supabaseUrl,
  supabaseAnonKey,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  /**
   * The values the browser bundle was compiled with, kept so the mismatch above
   * can be detected. On the server, `process.env.NEXT_PUBLIC_*` is the literal
   * the bundler substituted, not the current environment — which is exactly what
   * is needed here: this is the build's answer, compared against the runtime's.
   */
  publicSupabaseUrl: (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(
    /\/+$/,
    ""
  ),
  publicSupabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",

  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",

  /**
   * The Supabase Storage bucket holding case files and avatars.
   *
   * Defaults to `case-files` rather than being required, because the project
   * this platform runs on already *is* the storage provider: the same service
   * role key that creates an account can write an object, and the bucket needs
   * to exist either way. An explicit value is still honoured so the bucket can
   * be named, or pointed somewhere else, without a code change.
   */
  storageBucket: process.env.SUPABASE_STORAGE_BUCKET ?? "case-files",

  /**
   * Whether Supabase Storage can serve as the object store.
   *
   * Needs the service role key, which is the credential that bypasses RLS and so
   * the only one that can write to a private bucket. The anon key cannot: a
   * private bucket rejects it, which is the correct answer rather than a
   * misconfiguration to work around.
   */
  get hasSupabaseStorage() {
    return Boolean(this.supabaseServiceRoleKey && this.storageBucket);
  },

  /**
   * Whether object storage falls back to the local disk.
   *
   * A hosted bucket is the real backend and is used whenever one is reachable —
   * now Supabase Storage, and the Forge/S3 presigner where that is configured
   * instead. On a development machine none usually is, and refusing to start an
   * upload because of it makes the platform impossible to exercise - so
   * development with no credentials writes to a directory under the project
   * instead.
   *
   * Gated on `!isProduction` deliberately and not merely on the credentials
   * being absent: a deployed instance must never quietly accept uploads into
   * its own filesystem, where they would be lost on the next deploy and would
   * not be the same object the database key promises. Production with no
   * credentials is a misconfiguration and fails loudly instead.
   */
  get useLocalStorage() {
    return !this.isProduction && !this.forgeApiUrl && !this.hasSupabaseStorage;
  },
};
