import { describe, expect, it, vi, afterEach } from "vitest";

/**
 * What the sign-in screen tells an operator about a build that cannot sign in.
 *
 * Its own file because the values are read at module scope, so a test that wants
 * a build without them has to change the environment and import the module afresh
 * — the same constraint that gives `server/supabase.config.test.ts` its own
 * module registry.
 *
 * The anon key is the thing under test from the other direction. The project URL
 * is printed back when it is malformed, which is defensible because it is already
 * in the bundle; the key is not printed for anybody, so there is an assertion
 * here that no key value can reach this string.
 */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function buildWith(url?: string, anonKey?: string) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url ?? "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey ?? "");
  vi.resetModules();
  return import("./supabase");
}

describe("a build with usable configuration", () => {
  it("reports nothing wrong with it", async () => {
    const { isSupabaseConfigured, supabaseBuildFault } = await buildWith(
      "https://project.supabase.co",
      "anon-key"
    );

    expect(isSupabaseConfigured).toBe(true);
    // The screen renders this string only when there is a fault, so a `null`
    // here is what keeps the diagnosis off the page in the ordinary case.
    expect(supabaseBuildFault).toBeNull();
  });
});

describe("a build with no Supabase configuration at all", () => {
  it("names both variables", async () => {
    // The state a Vercel project is in before anyone visits the environment
    // settings. Both names are given, because "it is not configured" sends the
    // operator looking for a setting that exists.
    const { isSupabaseConfigured, supabaseBuildFault } = await buildWith();

    expect(isSupabaseConfigured).toBe(false);
    expect(supabaseBuildFault).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(supabaseBuildFault).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("says that a page already built cannot be given the variable", async () => {
    // The part that stops the second attempt at the wrong fix. This page was
    // compiled without the value and no environment change can reach it, so the
    // operator has to redeploy rather than restart.
    const { supabaseBuildFault } = await buildWith();

    expect(supabaseBuildFault).toMatch(/built|cannot be given it/i);
  });
});

describe("a build with a mangled project URL", () => {
  it("prints the value, so the stray character is visible", async () => {
    // The deployment this was written for. The value looks correct in the
    // dashboard and is wrong here, and there is no other place it appears — the
    // bundle reports only that it is not configured, which is true and useless.
    const { supabaseBuildFault } = await buildWith(
      '"https://project.supabase.co"',
      "anon-key"
    );

    expect(supabaseBuildFault).toContain('\\"https://project.supabase.co\\"');
    expect(supabaseBuildFault).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("reports a missing anon key alongside a bad URL", async () => {
    // Both at once is the likely real state, since the two are configured in the
    // same screen minutes apart. Reporting only the first would have the
    // operator fix it and come back to the same page.
    const { supabaseBuildFault } = await buildWith("nonsense");

    expect(supabaseBuildFault).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(supabaseBuildFault).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });
});

describe("the anon key", () => {
  it("is never printed, only reported missing", async () => {
    // The one genuinely secret-adjacent value in this file. The URL is printed
    // because a mangled one cannot be recognised without seeing it, and it is in
    // the bundle regardless. The key is printed to nobody, so a fault string is
    // asserted not to contain it even when it is present and the fault is
    // elsewhere.
    const { supabaseBuildFault } = await buildWith(
      "not-a-url",
      "anon-key-that-must-not-appear"
    );

    expect(supabaseBuildFault).not.toContain("anon-key-that-must-not-appear");
  });
});
