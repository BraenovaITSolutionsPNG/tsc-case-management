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
 * Every refusal here is also only ever written for a caller who presented a
 * session, which is why the last test in the database block asks for the silence
 * instead: a platform that cannot reach its database still has to be able to say
 * so to the one person it is true of, without saying it to everybody.
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
    // `authenticateSupabaseRequest` reads the session as well, for the
    // session id that tells one signed-in device from another. It reads
    // the cookie this process already has, so a null session is the
    // honest answer for these scenarios: none of them carries a token.
    getSession: vi.fn(),
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
  serverClient.auth.getSession.mockResolvedValue({
    data: { session: null },
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

  it("is not told to an officer who has not signed in yet", async () => {
    // The sign-in screen's fixed sentence under the refusal says the password
    // was accepted. That is assertable only about somebody who presented a
    // session — a visitor who has not typed anything has accepted nothing, and
    // sending them away from a form that will work the moment the platform can
    // reach its database is the one outcome the refusal must not cause.
    scenario({ database: false });
    serverClient.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    expect(await authenticateSupabaseRequest()).toBeNull();

    // Anonymous traffic never needed a database connection, and this is what
    // stops it opening one on every screen an unauthenticated visitor loads.
    expect(db.getDb).not.toHaveBeenCalled();
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
