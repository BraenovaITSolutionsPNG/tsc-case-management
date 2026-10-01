import { describe, expect, it, vi, afterEach } from "vitest";
import { appRouter } from "./routers";
import { createContext, type TrpcContext } from "./_core/context";
import { can } from "../shared/access";
import { ROLE_VALUES, type Role } from "../shared/roles";

/**
 * Self-registered accounts: what happens on first sign-in, and what an
 * administrator does about it.
 *
 * The arrangement under test is the one where Supabase owns sign-up completely.
 * Anyone can create an identity there, so an identity arriving at this platform
 * is not evidence of anything — and the whole question is whether a stranger who
 * has one can reach the case register.
 *
 * Two properties matter and they are tested from both directions, because either
 * alone is easy to get wrong:
 *
 *   - a first sign-in creates a row and grants nothing;
 *   - a pending row is refused on every subsequent request, so approving is the
 *     only thing that opens it.
 *
 * The service role is deliberately never stubbed in this file. Creating a
 * pending row is a plain INSERT on the application's own connection, and a test
 * that had to mock `auth.admin.createUser` would be asserting the arrangement
 * this change exists to remove.
 */

type DbUser = {
  id: number;
  openId: string;
  authUserId: string | null;
  email: string | null;
  name: string | null;
  role: Role;
  isActive: boolean;
  pendingApproval: boolean;
};

const AUTH_ID = "11111111-2222-4333-8444-555555555555";

/**
 * The `db` module, mocked down to the two functions this path uses.
 *
 * `createPendingUser` is mocked to reproduce what the real one does — insert a
 * locked row — so the assertions below are about the session path's decisions
 * rather than about SQL. The SQL is exercised against a real database by the
 * migration and `db:verify`.
 */
function mockDb(seed: DbUser[] = []) {
  const rows = [...seed];

  vi.doMock("./db", () => ({
    getUserByAuthUserId: async (authUserId: string) =>
      rows.find(r => r.authUserId === authUserId),
    createPendingUser: async ({
      authUserId,
      email,
      name,
    }: {
      authUserId: string;
      email: string | null;
      name: string | null;
    }) => {
      if (rows.some(r => r.authUserId === authUserId)) return;
      rows.push({
        id: rows.length + 1,
        openId: `supabase:${authUserId}`,
        authUserId,
        email,
        name,
        role: "staff",
        isActive: true,
        pendingApproval: true,
      });
    },
    touchLastSignedIn: async () => {},
    listUsers: async () => rows,
    approveUser: async (id: number) => {
      const row = rows.find(r => r.id === id);
      if (!row?.pendingApproval) return { approved: false };
      row.pendingApproval = false;
      return { approved: true };
    },
  }));

  return rows;
}

function mockSupabaseSession() {
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_ANON_KEY", "anon-test-key");

  vi.doMock("./_core/supabaseAuth", async importOriginal => ({
    ...(await importOriginal<typeof import("./_core/supabaseAuth")>()),
    createServerClient: vi.fn().mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          error: null,
          data: {
            user: {
              id: AUTH_ID,
              email: "newcomer@example.org",
              user_metadata: {},
            },
          },
        }),
      },
    }),
  }));
}

function context() {
  return { protocol: "https", headers: {} } as TrpcContext["req"];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("a first sign-in", () => {
  it("creates an account that is locked and grants nothing", async () => {
    // The load-bearing assertion. Supabase has accepted the identity, so the
    // platform has to decide what it is worth, and the answer is nothing until
    // an administrator says otherwise.
    const rows = mockDb();
    mockSupabaseSession();

    const { createContext: freshCreateContext } = await import(
      "./_core/context"
    );

    const ctx = await freshCreateContext(context());

    expect(ctx.user).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      authUserId: AUTH_ID,
      role: "staff",
      pendingApproval: true,
    });
  });

  it("tells the officer they are awaiting approval, not that the password is wrong", async () => {
    // `auth.me` answers null either way, so the reason is carried separately.
    // Without it the officer is shown a sign-in form that will not accept them,
    // which is indistinguishable from a bad password.
    mockDb();
    mockSupabaseSession();

    const { createContext: freshCreateContext } = await import(
      "./_core/context"
    );
    const ctx = await freshCreateContext(context());

    expect(ctx.refusal).toMatch(/awaiting approval/i);
    // The wording must not imply the credential was the problem.
    expect(ctx.refusal).not.toMatch(/password|invalid/i);
  });

  it("does not create a second row when the same identity signs in again", async () => {
    // Two requests from one person at once is ordinary — a double-tapped submit,
    // or a prefetch racing the first navigation. The unique constraint on
    // `authUserId` settles it, so the second is a no-op rather than an error.
    const rows = mockDb();
    mockSupabaseSession();

    const { createContext: freshCreateContext } = await import(
      "./_core/context"
    );

    await freshCreateContext(context());
    await freshCreateContext(context());
    await freshCreateContext(context());

    expect(rows).toHaveLength(1);
  });

  it("keeps refusing after approval only once the flag is cleared", async () => {
    // Two requests either side of the administrator's approval, to show the
    // refusal is the flag and not the account's existence.
    const rows = mockDb();
    mockSupabaseSession();

    const { createContext: freshCreateContext } = await import(
      "./_core/context"
    );

    await freshCreateContext(context());
    expect((await freshCreateContext(context())).user).toBeNull();

    rows[0]!.pendingApproval = false;
    const after = await freshCreateContext(context());

    expect(after.user).not.toBeNull();
    expect(after.user?.authUserId).toBe(AUTH_ID);
  });
});

describe("a pending account", () => {
  const pending: DbUser = {
    id: 7,
    openId: `supabase:${AUTH_ID}`,
    authUserId: AUTH_ID,
    email: "newcomer@example.org",
    name: "Newcomer",
    role: "staff",
    isActive: true,
    pendingApproval: true,
  };

  it("is refused even though it is active and provisioned", async () => {
    // The distinction that matters: `isActive` alone would let this through.
    // Anyone reading only that column would conclude a self-registered account
    // has access.
    mockDb([pending]);
    mockSupabaseSession();

    const { createContext: freshCreateContext } = await import(
      "./_core/context"
    );
    const ctx = await freshCreateContext(context());

    expect(ctx.user).toBeNull();
    expect(ctx.refusal).toMatch(/awaiting approval/i);
  });

  it("is reported as awaiting approval rather than as deactivated", async () => {
    // The two states send somebody to their administrator for opposite reasons,
    // and "deactivated" would read as a disciplinary action against them.
    mockDb([pending]);
    mockSupabaseSession();

    const { createContext: freshCreateContext } = await import(
      "./_core/context"
    );
    const ctx = await freshCreateContext(context());

    expect(ctx.refusal).not.toMatch(/deactivated/i);
  });
});

describe("a deactivated account", () => {
  it("is refused with a message that says so", async () => {
    // Not pending, so the pending branch must not swallow it.
    mockDb([
      {
        id: 9,
        openId: "seed-platform-owner",
        authUserId: AUTH_ID,
        email: "officer@example.org",
        name: "Officer",
        role: "super_admin",
        isActive: false,
        pendingApproval: false,
      },
    ]);
    mockSupabaseSession();

    const { createContext: freshCreateContext } = await import(
      "./_core/context"
    );
    const ctx = await freshCreateContext(context());

    expect(ctx.user).toBeNull();
    expect(ctx.refusal).toMatch(/deactivated/i);
  });
});

describe("approving an account", () => {
  const contextsFor = (role: Role | null) => {
    if (role === null) {
      return { user: null, req: context(), res: {} } as unknown as TrpcContext;
    }
    return {
      user: {
        id: 1,
        openId: "admin",
        authUserId: "99999999-2222-4333-8444-555555555555",
        email: "admin@example.org",
        name: "Admin",
        loginMethod: "supabase",
        role,
        isActive: true,
        pendingApproval: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastSignedIn: new Date(),
      },
      req: context(),
      res: {
        cookie: () => {},
        clearCookie: () => {},
      },
    } as unknown as TrpcContext;
  };

  it("is gated on exactly the capability that creates accounts", async () => {
    // Approval is the administrative half of creating an account, so it must be
    // reachable by precisely the tiers that can create one and nobody else —
    // asserted by comparing against the policy itself rather than a chosen few
    // tiers, so a tier added later cannot quietly acquire the ability to approve
    // a stranger.
    //
    // The distinction between "refused" and "did nothing" matters here: the
    // route also throws a business-rule error for an account that is not
    // pending, and counting that as an authorization failure would pass for every
    // tier including the ones that should get through. `FORBIDDEN` is what the
    // capability guard raises and the only thing that means "not allowed".
    mockDb([
      {
        id: 1,
        openId: `supabase:${AUTH_ID}`,
        authUserId: AUTH_ID,
        email: "newcomer@example.org",
        name: "Newcomer",
        role: "staff",
        isActive: true,
        pendingApproval: true,
      },
    ]);
    for (const role of ROLE_VALUES) {
      const caller = appRouter.createCaller(contextsFor(role));
      let forbidden = false;
      try {
        await caller.admin.users.approve({ id: 1 });
      } catch (error) {
        forbidden = (error as { code?: string })?.code === "FORBIDDEN";
      }
      expect(`${role}:${forbidden}`).toBe(
        `${role}:${!can(role, "platform:users")}`
      );
    }
  });

  it("is refused for an anonymous caller", async () => {
    mockDb();
    const caller = appRouter.createCaller(contextsFor(null));
    await expect(caller.admin.users.approve({ id: 1 })).rejects.toThrow();
  });
});
