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
const SESSION_ID = "9c1f6d20-0b3a-4f7e-8c11-a2d5e6f70819";

const db = {
  getDb: vi.fn(),
  getUserByAuthUserId: vi.fn(),
  touchLastSignedIn: vi.fn(),
};

vi.mock("./db", () => db);

/**
 * A syntactically valid JWT, because the session id is read out of its payload
 * and an unreadable one would silently answer null for every device.
 */
const ACCESS_TOKEN = [
  Buffer.from(JSON.stringify({ alg: "ES256", typ: "JWT" })).toString(
    "base64url"
  ),
  Buffer.from(
    JSON.stringify({ sub: AUTH_USER_ID, session_id: SESSION_ID })
  ).toString("base64url"),
  "signature",
].join(".");

const serverClient = {
  auth: {
    // The session is read first and off the cookie this process already has, so
    // a null session is the honest answer for an anonymous scenario — and it is
    // what lets an anonymous request skip verification of every kind.
    getSession: vi.fn(),
    // `getUser` is declared so the assertion that it is *never* called has
    // something to be about. It is the call that went to Supabase on every
    // request; `getClaims` verifies the same signature against the cached JWKS.
    getUser: vi.fn(),
    getClaims: vi.fn(),
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
  /** Default: the caller presented a token. */
  signedIn?: boolean;
}) {
  const signedIn = options.signedIn ?? true;

  db.getDb.mockResolvedValue(options.database ? {} : null);
  db.getUserByAuthUserId.mockResolvedValue(options.row ?? undefined);
  db.touchLastSignedIn.mockResolvedValue(undefined);

  serverClient.auth.getSession.mockResolvedValue({
    data: { session: signedIn ? { access_token: ACCESS_TOKEN } : null },
    error: null,
  });
  serverClient.auth.getClaims.mockResolvedValue({
    data: {
      claims: { sub: AUTH_USER_ID },
      header: {},
      signature: new Uint8Array(),
    },
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

  it("is not told to an officer who has not signed in yet", async () => {
    // The sign-in screen's fixed sentence under the refusal says the password
    // was accepted. That is assertable only about somebody who presented a
    // session — a visitor who has not typed anything has accepted nothing, and
    // sending them away from a form that will work the moment the platform can
    // reach its database is the one outcome the refusal must not cause.
    scenario({ database: false, signedIn: false });

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
    scenario({ database: true, signedIn: false });

    expect(await authenticateSupabaseRequest()).toBeNull();

    // And it costs nothing to say so: no token means nothing to verify, so the
    // request never reaches the verification call at all. This is the sign-in
    // screen's own traffic, and it is the reason the session is read first.
    expect(serverClient.auth.getClaims).not.toHaveBeenCalled();
    expect(db.getDb).not.toHaveBeenCalled();
  });
});

describe("verifying the token", () => {
  it("checks the signature against the cached key set, never over the network", async () => {
    scenario({
      database: true,
      row: { id: 1042, isActive: true, role: "staff" },
    });

    await authenticateSupabaseRequest();

    // The whole point of the change, and the reason it is asserted rather than
    // described: `getUser` sends a request to Supabase for every token, and a
    // signed-in page load ran it once for the Server Component's render and again
    // for every batched client query. `getClaims` verifies the same signature
    // against the project's JWKS, which is fetched once and cached.
    expect(serverClient.auth.getClaims).toHaveBeenCalledWith(ACCESS_TOKEN);
    expect(serverClient.auth.getUser).not.toHaveBeenCalled();
  });

  it("names one signed-in device from another", async () => {
    scenario({
      database: true,
      row: { id: 1042, isActive: true, role: "staff" },
    });

    // Read out of the token's payload, which is only safe because the signature
    // above was verified first.
    expect(await authenticateSupabaseRequest()).toMatchObject({
      sessionId: SESSION_ID,
    });
  });

  it("treats a token that will not verify as no token", async () => {
    scenario({ database: true });
    serverClient.auth.getClaims.mockResolvedValue({
      data: null,
      error: {
        __isAuthError: true,
        name: "AuthInvalidJwtError",
        message: "Invalid JWT signature",
      },
    });

    // An expired or forged token — which a stale tab produces routinely — is not
    // a hard error, it is "not signed in yet". The honest answer is null, and no
    // network call is made to confirm a verdict we already have.
    expect(await authenticateSupabaseRequest()).toBeNull();
    expect(db.getDb).not.toHaveBeenCalled();
    expect(serverClient.auth.getUser).not.toHaveBeenCalled();
  });

  it("asks Supabase when the key set could not be fetched", async () => {
    // The marker and the name are both required: the library's own predicate is
    // `isAuthError(e) && e.name === "AuthRetryableFetchError"`, and a mock
    // carrying only the name would pass a test while proving nothing.
    // The one failure mode that must not be read as a verdict. `getClaims`
    // verifies against a key set it has to fetch on a cold start, so the first
    // request after a deploy depends on that call — and a blip there would
    // otherwise present as every officer signed out at once.
    scenario({
      database: true,
      row: { id: 1042, isActive: true, role: "staff" },
    });
    serverClient.auth.getClaims.mockResolvedValue({
      data: null,
      error: {
        __isAuthError: true,
        name: "AuthRetryableFetchError",
        message: "network",
      },
    });
    serverClient.auth.getUser.mockResolvedValue({
      data: { user: { id: AUTH_USER_ID } },
      error: null,
    });

    // Falls back rather than failing closed: the token is fine, we simply could
    // not check it the fast way.
    expect(await authenticateSupabaseRequest()).toMatchObject({
      authUserId: AUTH_USER_ID,
    });
    expect(serverClient.auth.getUser).toHaveBeenCalledWith(ACCESS_TOKEN);
  });

  it("still answers null when the fallback is refused too", async () => {
    // The fallback is a second opinion, not a way past a real refusal: if
    // Supabase rejects the token as well, the token is no good.
    scenario({ database: true });
    serverClient.auth.getClaims.mockResolvedValue({
      data: null,
      error: {
        __isAuthError: true,
        name: "AuthRetryableFetchError",
        message: "network",
      },
    });
    serverClient.auth.getUser.mockResolvedValue({
      data: null,
      error: {
        __isAuthError: true,
        name: "AuthSessionMissingError",
        message: "no session",
      },
    });

    expect(await authenticateSupabaseRequest()).toBeNull();
    expect(db.getDb).not.toHaveBeenCalled();
  });

  it("treats claims with no subject as no token", async () => {
    scenario({ database: true });
    serverClient.auth.getClaims.mockResolvedValue({
      data: { claims: {}, header: {}, signature: new Uint8Array() },
      error: null,
    });

    // `sub` is the only claim used for identity, and it is the join to our own
    // register row. Without it there is nobody to look up.
    expect(await authenticateSupabaseRequest()).toBeNull();
    expect(db.getUserByAuthUserId).not.toHaveBeenCalled();
  });
});
