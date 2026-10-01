import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * What a request is told when the caller cannot be resolved.
 *
 * Three refusals and one silence, and the refusals are the point: each names a
 * fault with a different fix, so reporting one as another costs an afternoon.
 * The database case is the one this file exists for — `getUserByAuthUserId`
 * answers `undefined` for a missing database and for a missing row alike, and an
 * unreachable database that presents as "this account has not been set up" sends
 * the operator off to create an account that already exists.
 *
 * The database module is mocked rather than pointed at a real one, because the
 * behaviour under test *is* the branch taken when there is no database, and a
 * real connection would make the interesting case the unreachable one.
 */

const AUTH_USER_ID = "4e47a4b5-9793-4a01-9995-b00a5efbd271";

const db = {
  getDb: vi.fn(),
  getUserByAuthUserId: vi.fn(),
  touchLastSignedIn: vi.fn(),
};

vi.mock("./db", () => db);

const serverClient = {
  auth: {
    getUser: vi.fn(),
  },
};

vi.mock("./_core/supabaseAuth", () => ({
  createServerClient: async () => serverClient,
}));

const { authenticateSupabaseRequest } = await import("./_core/supabaseSession");

/** A connected database, a signed-in caller, and the row it resolves to. */
function scenario(options: {
  database: boolean;
  row?: Record<string, unknown> | null;
}) {
  db.getDb.mockResolvedValue(options.database ? {} : null);
  db.getUserByAuthUserId.mockResolvedValue(options.row ?? undefined);
  db.touchLastSignedIn.mockResolvedValue(undefined);
  serverClient.auth.getUser.mockResolvedValue({
    data: { user: { id: AUTH_USER_ID } },
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a platform that cannot reach its database", () => {
  it("says so, rather than saying the account is not set up", async () => {
    scenario({ database: false });

    // The officer proved who they are, so "contact an administrator" about
    // their account is a statement this platform cannot support: it has not
    // looked. And the operator reading it would go and create the account that
    // is sitting there already.
    await expect(authenticateSupabaseRequest()).rejects.toThrow(
      /cannot reach its database/
    );
    await expect(authenticateSupabaseRequest()).rejects.not.toThrow(
      /not been set up/
    );
  });

  it("never asks the database who the caller is", async () => {
    scenario({ database: false });

    await expect(authenticateSupabaseRequest()).rejects.toThrow();

    // Asserted because a lookup against a database that is not there is the
    // query that throws the connection error this branch exists to pre-empt,
    // and the log would then name a driver failure instead of the cause.
    expect(db.getUserByAuthUserId).not.toHaveBeenCalled();
  });
});

describe("a session with no register row", () => {
  it("is refused as an account that was never set up", async () => {
    scenario({ database: true, row: null });

    await expect(authenticateSupabaseRequest()).rejects.toThrow(
      /not been set up/
    );
  });
});

describe("a session that resolves", () => {
  it("returns the officer and records that they were here", async () => {
    scenario({
      database: true,
      row: {
        id: 1042,
        name: "Joel Namuri",
        email: "joelnamuri005@gmail.com",
        role: "super_admin",
        isActive: true,
      },
    });

    const user = await authenticateSupabaseRequest();

    expect(user).toMatchObject({ id: 1042, authUserId: AUTH_USER_ID });
    expect(db.getUserByAuthUserId).toHaveBeenCalledWith(AUTH_USER_ID);
    expect(db.touchLastSignedIn).toHaveBeenCalledWith(1042, expect.any(Date));
  });

  it("refuses a deactivated officer, and does not record them as here", async () => {
    // A deactivated officer may hold an unexpired session, so the account has to
    // be refused on every request — and the audit column must not claim they
    // were working.
    scenario({
      database: true,
      row: { id: 1042, isActive: false, role: "staff" },
    });

    await expect(authenticateSupabaseRequest()).rejects.toThrow(/deactivated/);
    expect(db.touchLastSignedIn).not.toHaveBeenCalled();
  });

  it("answers null for a request with no session at all", async () => {
    // Not an error. Public procedures have to work for an anonymous visitor, and
    // the database being present is all this needs to know.
    scenario({ database: true });
    serverClient.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    expect(await authenticateSupabaseRequest()).toBeNull();
  });
});
