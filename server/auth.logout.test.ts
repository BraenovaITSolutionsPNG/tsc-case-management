import { describe, expect, it, vi, afterEach } from "vitest";
import { appRouter } from "./routers";
import { createContextFromUser, type TrpcContext } from "./_core/context";

type CookieCall = {
  name: string;
  value: string;
  options: Record<string, unknown>;
};

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): {
  ctx: TrpcContext;
  clearedCookies: CookieCall[];
} {
  const clearedCookies: CookieCall[] = [];

  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    authUserId: "00000000-0000-4000-8000-000000000001",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "supabase",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx = createContextFromUser(
    { protocol: "https", headers: {} },
    user
  );

  return {
    ctx: { ...ctx, res: {
      clearCookie: (name: string, options: Record<string, unknown>) => {
        clearedCookies.push({ name, value: "", options });
      },
    } } as TrpcContext,
    clearedCookies,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("auth.logout", () => {
  it("clears the session cookie and reports success", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
    expect(clearedCookies[0]?.options).toMatchObject({
      maxAge: -1,
      secure: true,
      sameSite: "none",
      httpOnly: true,
      path: "/",
    });
  });

  it("signs out of Supabase so the session stops resolving server-side", async () => {
    // Clearing one cookie of our own would leave the session Supabase actually
    // reads in place, and the officer would be signed out in the interface
    // while every request behind it still authenticated. Asserted directly
    // because this is the one part of sign-out that cannot be seen from the
    // outside.
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-test-key");

    const signOut = vi.fn().mockResolvedValue({ error: null });
    // Partial, so the real `isSupabaseConfigured` and the rest of the module
    // are still there. A full replacement would make any other test in this
    // file that imports the module fail on a missing export rather than on the
    // thing it is actually checking.
    vi.doMock("./_core/supabaseAuth", async importOriginal => ({
      ...(await importOriginal<typeof import("./_core/supabaseAuth")>()),
      createServerClient: vi.fn().mockResolvedValue({
        auth: { signOut },
      }),
    }));

    const { appRouter: freshRouter } = await import("./routers");
    const { ctx } = createAuthContext();

    const result = await freshRouter.createCaller(ctx).auth.logout();

    expect(result).toEqual({ success: true });
    expect(signOut).toHaveBeenCalledOnce();
  });

  it("still ends the browser session when Supabase cannot be reached", async () => {
    // An outage must not leave an officer unable to leave a shared machine. The
    // cookie clear happens regardless of what Supabase said.
    vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("SUPABASE_ANON_KEY", "anon-test-key");

    vi.doMock("./_core/supabaseAuth", async importOriginal => ({
      ...(await importOriginal<typeof import("./_core/supabaseAuth")>()),
      createServerClient: vi.fn().mockRejectedValue(new Error("network down")),
    }));

    const { appRouter: freshRouter } = await import("./routers");
    const { ctx, clearedCookies } = createAuthContext();

    const result = await freshRouter.createCaller(ctx).auth.logout();

    expect(result).toEqual({ success: true });
    expect(clearedCookies).toHaveLength(1);
  });
});

/**
 * A deployment with no Supabase configuration is covered in
 * supabase.config.test.ts, which is a separate file on purpose: this one mocks
 * the Supabase module, and a mock registered for one test stays registered for
 * the next one in the same file. Asserting that the *real* module reports
 * misconfiguration from inside a file that has replaced it would be testing the
 * mock.
 */
