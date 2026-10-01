// First, and deliberately: `next dev` and `next build` load .env themselves, a
// plain `tsx` script does not, and `ENV` below reads the environment once at
// import time. dotenv never overwrites a variable that is already set, so an
// explicit DATABASE_URL on the command line — which is how this is run against
// a hosted database — still wins.
import "dotenv/config";
import { ENV } from "./_core/env";
import { getUserByEmail, setUserRole } from "./db";
import { provisionUser, setPasswordDirectly } from "./auth/provisioning";

/**
 * Create the first account on an empty platform.
 *
 * The platform has no way to make its own first user. The admin screen that
 * creates accounts sits behind a capability only an administrator already
 * holds, so on a fresh database there is nobody to sign in as and no way in.
 *
 * This closes that from outside the request path, deliberately. It reads its
 * configuration from the environment, it is a command someone runs against a
 * database they already hold the credentials for, and it can only ever produce
 * the one account that is missing. Nothing in the application imports it, and no
 * route reaches it.
 *
 * The identity is created in Supabase first, by the same function the admin
 * screen uses, so the seed cannot produce an arrangement that path considers
 * invalid.
 *
 * Idempotent, because this is run every time a database is rebuilt. Re-running
 * it leaves an existing account alone unless SEED_ADMIN_PASSWORD is offered
 * again, which is how a deliberately lost password is replaced — and that
 * replacement now goes through Supabase, because this process can no longer
 * write a credential the sign-in path would read.
 *
 *   DATABASE_URL=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
 *   SUPABASE_SERVICE_ROLE_KEY=... SEED_ADMIN_PASSWORD=... pnpm db:seed
 *
 * SEED_ADMIN_PASSWORD is optional. Without it the account is created with no
 * password, and the operator is told to use a reset link — which is the better
 * arrangement when one is available, because no administrator ever handles the
 * password.
 *
 * SEED_ADMIN_EMAIL, SEED_ADMIN_NAME and SEED_ADMIN_USERNAME override the
 * identity. They are overridable because the address is not a detail here: it
 * is where Supabase sends a recovery mail, and an administrator seeded at the
 * default below can never be locked out by the reset path, because nothing can
 * be delivered to it. That failure is invisible until the moment it is needed.
 */

/**
 * The account's identity. Every field has an environment override and a default,
 * and the defaults are the placeholder values from before Supabase — an
 * `example.com` address that can receive nothing.
 */
const OWNER = {
  username: process.env.SEED_ADMIN_USERNAME?.trim() || "admin",
  name: process.env.SEED_ADMIN_NAME?.trim() || "Platform Administrator",
  email: process.env.SEED_ADMIN_EMAIL?.trim() || "admin@example.com",
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
  if (!ENV.supabaseUrl || !ENV.supabaseServiceRoleKey) {
    return fail(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set. The first account is a Supabase identity, and this script needs the service role to create one."
    );
  }

  const offered = process.env.SEED_ADMIN_PASSWORD?.trim();

  // Refused in production rather than warned about. The placeholder address
  // cannot receive a recovery mail, so the one account that can unlock the
  // platform becomes unrecoverable by the only documented route — and the
  // failure is discovered at the worst possible moment, by whoever is not in
  // possession of the service role key. `example.com` is reserved by RFC 2606
  // precisely so it can be recognised as a placeholder, which is what this tests.
  if (
    ENV.isProduction &&
    !process.env.SEED_ADMIN_EMAIL?.trim() &&
    OWNER.email.endsWith("@example.com")
  ) {
    return fail(
      "Refusing to create the first administrator at the placeholder address admin@example.com. Set SEED_ADMIN_EMAIL to a real address: it is where Supabase sends a password reset, and an administrator that cannot receive one cannot be recovered."
    );
  }

  // Looked up by email rather than username: the Supabase identity is keyed on
  // the address, so that is the thing that decides whether this account already
  // exists, and a row with no identity is exactly the broken state this is
  // meant to prevent rather than to skip past.
  const existing = await getUserByEmail(OWNER.email);

  if (!existing) {
    await provisionUser({
      name: OWNER.name,
      email: OWNER.email,
      username: OWNER.username,
      role: "super_admin",
      password: offered || null,
    });

    if (offered) {
      console.log(
        `[seed] Created ${OWNER.email} as super_admin with the password you supplied.`
      );
      console.log("[seed] Sign in at /login with that email and password.");
    } else {
      console.log(
        `[seed] Created ${OWNER.email} as super_admin with no password set.`
      );
      console.log(
        "[seed] Set one before anyone needs it: run this again with SEED_ADMIN_PASSWORD, or use the admin screen's password reset once signed in."
      );
    }
    return;
  }

  if (!existing.authUserId) {
    return fail(
      `Account ${existing.id} (${existing.email ?? existing.name}) has no Supabase identity, so it cannot sign in. Delete the row and re-run, or link an identity from the admin screen.`
    );
  }

  // The account is already there. Repairing the role is safe and idempotent.
  if (existing.role !== "super_admin") {
    await setUserRole(existing.id, "super_admin");
    console.log(
      `[seed] Promoted ${existing.email ?? existing.name} to super_admin.`
    );
  } else {
    console.log(
      `[seed] ${existing.email ?? existing.name} already exists as super_admin.`
    );
  }

  if (!offered) {
    console.log(
      "[seed] SEED_ADMIN_PASSWORD was not set, so nothing was changed."
    );
    return;
  }

  await setPasswordDirectly(existing.authUserId, offered);
  console.log(
    `[seed] Password replaced for ${existing.email ?? existing.name}. The value was not written anywhere.`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[seed] Failed:", error);
    process.exit(1);
  });
