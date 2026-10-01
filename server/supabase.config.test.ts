import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * How a deployment with no Supabase configuration reports itself.
 *
 * Its own file because `ENV` is built once at import time, so the only way to
 * test a build without Supabase is to change the environment and rebuild the
 * module graph — which means a fresh module registry, and therefore a test file
 * of its own. Doing it alongside a file that mocks the Supabase module would
 * assert against the mock rather than against the real thing.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("a deployment with no Supabase configuration", () => {
  it("reports itself as unconfigured rather than as a wrong password", async () => {
    // This is the assertion that matters for the officer. The sign-in screen
    // asks Supabase to verify a session, and with nothing configured that
    // request cannot be made. Reporting it as a rejected credential would be
    // false, and it would send the officer off to retype a password that was
    // never the problem.
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.resetModules();

    const { isSupabaseConfigured, supabasePublicConfig } = await import(
      "./_core/supabaseAuth"
    );

    expect(isSupabaseConfigured()).toBe(false);
    // And it says what is missing, so a misconfigured deployment is
    // diagnosable from the log rather than from a blank screen.
    expect(() => supabasePublicConfig()).toThrow(/not configured/i);
  });

  it("refuses to build a server client, naming both variables", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.resetModules();

    const { createServerClient } = await import("./_core/supabaseAuth");

    await expect(createServerClient()).rejects.toThrow(
      /SUPABASE_URL and SUPABASE_ANON_KEY/
    );
  });

  it("treats a half-configured deployment as unconfigured", async () => {
    // A URL with no key, or a key with no URL, is not a working deployment. The
    // sign-in screen shows an explanation on this basis, so the two are checked
    // together rather than one at a time.
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.resetModules();

    const { isSupabaseConfigured } = await import("./_core/supabaseAuth");
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("refuses to build the service-role client without its key", async () => {
    // The service role bypasses row level security. A deployment that has the
    // public half and not the private half is the normal case during a first
    // setup, and the administrator features must say so rather than quietly
    // doing nothing.
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.resetModules();

    const { isSupabaseAdminConfigured, createAdminClient } = await import(
      "./_core/supabaseAuth"
    );

    expect(isSupabaseAdminConfigured()).toBe(false);
    expect(() => createAdminClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("is configured when both public values are present", async () => {
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
    vi.resetModules();

    const { isSupabaseConfigured, supabasePublicConfig } = await import(
      "./_core/supabaseAuth"
    );

    expect(isSupabaseConfigured()).toBe(true);
    expect(supabasePublicConfig()).toEqual({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
    });
  });

  it("tolerates a trailing slash on the project URL", async () => {
    // Supabase prints the URL with a trailing slash in the dashboard, and a
    // pasted value carrying one would otherwise produce `...co//auth/v1/user`
    // when it is joined to a path. A redirect rather than a failure: a working
    // deployment should not be down over a slash someone copied.
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co///");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
    vi.resetModules();

    const { supabasePublicConfig } = await import("./_core/supabaseAuth");

    expect(supabasePublicConfig().url).toBe("https://project.supabase.co");
  });

  it("names the variable and the value when the project URL is not a URL", async () => {
    // The deployment this was added for: both halves set, so every
    // "is it configured?" check in the codebase answered yes, and the first
    // sign-in attempt produced "Invalid supabaseUrl: Must be a valid HTTP or
    // HTTPS URL" from inside the Supabase library — an error that names neither
    // the variable nor the value, and arrives via the console warning in
    // createContext that swallows it into a log line.
    vi.stubEnv("SUPABASE_URL", '"https://project.supabase.co"');
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
    vi.resetModules();

    const { isSupabaseConfigured, supabasePublicConfig, createServerClient } =
      await import("./_core/supabaseAuth");

    // Configured and unusable is the state this must refuse to report as
    // configured, or the sign-in screen offers a form that cannot work.
    expect(isSupabaseConfigured()).toBe(false);
    expect(() => supabasePublicConfig()).toThrow(/not a URL/);
    expect(() => supabasePublicConfig()).toThrow(
      /SUPABASE_URL \/ NEXT_PUBLIC_SUPABASE_URL/
    );
    expect(() => supabasePublicConfig()).toThrow(/project\.supabase\.co/);
    await expect(createServerClient()).rejects.toThrow(/not a URL/);
  });

  it("still calls a missing URL unconfigured rather than malformed", async () => {
    // The other fault, and it must not be reported as this one: the fix for an
    // unset variable is to set it, not to go looking for stray quotes in it.
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
    vi.resetModules();

    const { supabasePublicConfig } = await import("./_core/supabaseAuth");

    expect(() => supabasePublicConfig()).toThrow(/not configured/i);
  });
});

describe("the NEXT_PUBLIC_ and server-side names", () => {
  it("reads the browser's names when they are the only ones set", async () => {
    // The common case on Vercel: one pair of variables, named for the browser,
    // inlined into the bundle at build time. The server must not insist on the
    // unprefixed spellings as well.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.resetModules();

    const { isSupabaseConfigured, supabasePublicConfig } = await import(
      "./_core/supabaseAuth"
    );

    expect(isSupabaseConfigured()).toBe(true);
    expect(supabasePublicConfig()).toEqual({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
    });
  });

  it("refuses a server and a browser pointing at different projects", async () => {
    // The failure this exists to prevent. Both halves are configured, so every
    // "is it configured?" check passes, and an officer signs in successfully
    // against one project while this process looks their account up in another
    // and finds no row. Reported as an invalid credential, which is false, for a
    // password that was correct. Nothing in the symptom points at the build.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://built-for-one.supabase.co");
    vi.stubEnv("SUPABASE_URL", "https://runtime-uses-two.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
    vi.resetModules();

    const { isSupabaseConfigured, supabasePublicConfig } = await import(
      "./_core/supabaseAuth"
    );

    // Configured, and wrong. Being configured is not the same as being coherent,
    // and only the second is what stops the deployment going out.
    expect(isSupabaseConfigured()).toBe(true);
    expect(() => supabasePublicConfig()).toThrow(
      /built-for-one\.supabase\.co[\s\S]*runtime-uses-two\.supabase\.co/
    );
  });

  it("accepts both names when they agree", async () => {
    // A deployment that sets all four, because they are the same two values
    // written twice for a browser and a server, must not be treated as the
    // failure above. The check is for disagreement, not for repetition.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co/");
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-key");
    vi.resetModules();

    const { supabasePublicConfig } = await import("./_core/supabaseAuth");

    expect(supabasePublicConfig()).toEqual({
      url: "https://project.supabase.co",
      anonKey: "anon-key",
    });
  });
});
