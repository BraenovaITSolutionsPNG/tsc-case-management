import { describe, expect, it } from "vitest";
import { isSupabaseUrl, supabaseUrlFault } from "./supabaseUrl";

/**
 * What counts as a Supabase project URL this deployment can use.
 *
 * Its own file because the answer is shared by two runtimes — the server that
 * builds a session client and the browser that builds the sign-in client — and
 * because the values being rejected are the ones that look correct in a
 * dashboard, which is exactly the kind of thing a test has to hold still to be
 * worth anything.
 */

const SOURCE = "SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL";

describe("isSupabaseUrl", () => {
  it("accepts the address Supabase prints in its dashboard", () => {
    expect(isSupabaseUrl("https://zluxwwxzzxlydgnzmeyh.supabase.co")).toBe(
      true
    );
  });

  it("accepts the address with a trailing slash", () => {
    // The dashboard copies both ways depending on where it is copied from, and
    // a working deployment should not go down over a slash someone copied.
    expect(isSupabaseUrl("https://project.supabase.co/")).toBe(true);
  });

  it("tolerates whitespace around the value", () => {
    // A dashboard field and a shell export both end in a newline. It is not a
    // fault, and treating it as one would make the check a nuisance.
    expect(isSupabaseUrl("  https://project.supabase.co\n")).toBe(true);
  });

  it("rejects nothing at all", () => {
    expect(isSupabaseUrl("")).toBe(false);
    expect(isSupabaseUrl("   ")).toBe(false);
    expect(isSupabaseUrl(undefined)).toBe(false);
    expect(isSupabaseUrl(null)).toBe(false);
  });

  it("rejects an address still wrapped in the quotes of a shell export", () => {
    // The paste this exists for. `SUPABASE_URL="https://..."` copied out of a
    // terminal or a `.env` line brings the quotes with it, and the value is
    // non-empty, so every truthiness check in the codebase says the deployment
    // is configured and the first sign-in attempt is the first evidence
    // otherwise.
    expect(isSupabaseUrl('"https://project.supabase.co"')).toBe(false);
    expect(isSupabaseUrl("'https://project.supabase.co'")).toBe(false);
  });

  it("rejects an address with the variable name still attached", () => {
    expect(isSupabaseUrl("SUPABASE_URL=https://project.supabase.co")).toBe(
      false
    );
  });

  it("rejects an unfilled placeholder", () => {
    expect(isSupabaseUrl("your-project-url")).toBe(false);
    expect(isSupabaseUrl("<your-project-ref>.supabase.co")).toBe(false);
  });

  it("rejects a scheme that is not http", () => {
    expect(isSupabaseUrl("postgres://project.supabase.co")).toBe(false);
  });
});

describe("supabaseUrlFault", () => {
  it("has nothing to say about a usable address", () => {
    expect(supabaseUrlFault("https://project.supabase.co", SOURCE)).toBeNull();
  });

  it("leaves an absent value to the caller that reports absence", () => {
    // Not a fault here. An unset variable and a mangled one are different
    // problems with different fixes, and folding them together would send the
    // operator to edit a variable that is not set at all.
    expect(supabaseUrlFault("", SOURCE)).toBeNull();
    expect(supabaseUrlFault(undefined, SOURCE)).toBeNull();
  });

  it("names the value it was given, quotes and all", () => {
    // The operator reads the dashboard, where the field looks correct. Quoting
    // the value back is the only part of this message that shows them the
    // difference, so the quotes have to survive into it — escaped, because the
    // value is escaped: `"\"https://…\""` is unambiguous where a bare
    // interpolation would be a line that looks the same in the log as one that
    // is correct.
    const fault = supabaseUrlFault('"https://project.supabase.co"', SOURCE);

    expect(fault).toContain('\\"https://project.supabase.co\\"');
    expect(fault).toContain(SOURCE);
  });

  it("shows a trailing newline rather than hiding it", () => {
    // A newline on its own is trimmed away and accepted, so it only reaches the
    // message alongside another fault — which is the case here, and the reason
    // the message escapes what it prints rather than interpolating it.
    const fault = supabaseUrlFault('"https://project.supabase.co"\n', SOURCE);

    expect(fault).toContain("\\n");
  });

  it("says what the value should look like", () => {
    // A refusal with no remedy is a refusal the operator cannot act on.
    expect(supabaseUrlFault("nonsense", SOURCE)).toContain(
      "https://<project-ref>.supabase.co"
    );
  });
});
