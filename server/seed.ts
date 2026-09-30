// First, and deliberately: `next dev` and `next build` load .env themselves, a
// plain `tsx` script does not, and `ENV` below reads the environment once at
// import time. dotenv never overwrites a variable that is already set, so an
// explicit DATABASE_URL on the command line — which is how this is run against
// a hosted database — still wins.
import "dotenv/config";
import { ENV } from "./_core/env";
import { hashPassword, validatePassword } from "./_core/localAuth";
import {
  createUser,
  getUserByLocalUsername,
  setUserPassword,
  setUserRole,
} from "./db";

/**
 * Create the first account on an empty database.
 *
 * The platform has no way to make its own first user. The route that sets a
 * credential answers 404 in production, deliberately — it is the shortcut that
 * would otherwise let any anonymous caller mint themselves a super
 * administrator — and the admin screen that creates accounts sits behind a
 * capability only an administrator already holds. So on a fresh database there
 * is nobody to sign in as and no way in.
 *
 * This closes that from outside the request path, deliberately. It reads its
 * configuration from the environment, it is a command someone runs against a
 * database they already hold the credentials for, and it can only ever produce
 * the one account that is missing. Nothing in the application imports it, and no
 * route reaches it.
 *
 * Idempotent, because this is run again every time a database is rebuilt:
 * re-running it leaves an existing account's role and password alone unless
 * SEED_ADMIN_PASSWORD is offered again, which is how a deliberately lost
 * password is replaced.
 *
 *   DATABASE_URL=... SEED_ADMIN_PASSWORD=... pnpm db:seed
 */

/** The account's identity. Fixed rather than configurable: one owner, by name. */
const OWNER = {
  openId: "seed-platform-owner",
  username: "admin",
  name: "Platform Administrator",
  email: "admin@example.com",
} as const;

function fail(message: string): never {
  console.error(`[seed] ${message}`);
  process.exit(1);
}

async function main() {
  if (!ENV.databaseUrl) {
    return fail(
      "DATABASE_URL is not set. Point it at the database the deployment uses."
    );
  }

  const offered = process.env.SEED_ADMIN_PASSWORD?.trim();
  const existing = await getUserByLocalUsername(OWNER.username);
  const credential = offered ?? "";

  if (!existing) {
    // The same rule the admin screen enforces, so the seed cannot create an
    // account the screen meant to manage would then reject.
    const problem = validatePassword(credential);
    if (problem) {
      return fail(
        `${problem} Set SEED_ADMIN_PASSWORD to one that satisfies it — the seed will not invent a credential.`
      );
    }

    await createUser({
      openId: OWNER.openId,
      name: OWNER.name,
      email: OWNER.email,
      username: OWNER.username,
      role: "super_admin",
      passwordHash: hashPassword(credential),
    });
    console.log(
      `[seed] Created "${OWNER.username}" as super_admin. Sign in at /login with that username.`
    );
    console.log(
      "[seed] Change the password from the admin screen once you are in, and add the other officers from there."
    );
    return;
  }

  // The account is already there. Repairing the role is safe and idempotent.
  if (existing.role !== "super_admin") {
    await setUserRole(existing.id, "super_admin");
    console.log(`[seed] Promoted "${OWNER.username}" to super_admin.`);
  } else {
    console.log(`[seed] "${OWNER.username}" already exists as super_admin.`);
  }

  if (!offered) {
    console.log(
      "[seed] SEED_ADMIN_PASSWORD was not set, so the password is unchanged."
    );
    return;
  }

  // Re-keying goes through the same helper the admin screen uses, so the stored
  // value is a hash this codebase can verify.
  await setUserPassword(existing.id, hashPassword(offered));
  console.log(`[seed] Re-keyed "${OWNER.username}".`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[seed] Failed:", error);
    process.exit(1);
  });
