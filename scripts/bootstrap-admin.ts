// First, and for the same reason as server/seed.ts: `next dev` loads .env
// itself, a plain `tsx` script does not.
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

/**
 * Create the first administrator, entirely over HTTPS.
 *
 * `pnpm db:seed` does this through the application's own database connection,
 * which needs a reachable Postgres port and a verified TLS certificate. On this
 * machine neither is available: the direct host publishes only an AAAA record,
 * the pooler's port is firewalled, and the certificate that would let a runner
 * through has to be fetched from the dashboard by hand. All three block a
 * one-off bootstrap on credentials that are sitting right there.
 *
 * So this does the same work through Supabase's own HTTPS APIs instead:
 *
 *   Supabase Auth admin API  -> creates the identity
 *   PostgREST                -> writes the register row
 *
 * Both accept the service-role key, which bypasses row level security — the
 * same privilege `pnpm db:seed` needs, used here only because this is a
 * bootstrap run by someone who already holds it. The end state is identical to
 * what the seed produces, so `db:seed` can still be used afterwards and will
 * find the account already there and leave it alone.
 *
 * Nothing else in the application does this, and nothing does it on a request.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SEED_ADMIN_EMAIL=... \
 *     pnpm admin:bootstrap
 */

const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const email = process.env.SEED_ADMIN_EMAIL?.trim();
const name = process.env.SEED_ADMIN_NAME?.trim() || "Platform Administrator";
const username = process.env.SEED_ADMIN_USERNAME?.trim() || "admin";
const offered = process.env.SEED_ADMIN_PASSWORD?.trim();

function fail(message: string): never {
  console.error(`[bootstrap] ${message}`);
  process.exit(1);
}

async function main() {
  if (!url) fail("SUPABASE_URL is not set.");
  if (!serviceKey) {
    fail(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Creating an identity needs it — Supabase exposes no other way to create a user."
    );
  }
  if (!email) {
    fail(
      "SEED_ADMIN_EMAIL is not set. It is not a detail: it is where Supabase sends a password reset, and an administrator whose address cannot receive one cannot be recovered."
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });

  // Already there? Then this is a re-run and there is nothing to do. Checked
  // before creating anything, because creating an identity for an address that
  // already has one fails at Supabase and leaves the operator guessing whether
  // the failure was the address or the role.
  const { data: existingList, error: listError } =
    await supabase.auth.admin.listUsers({
      perPage: 200,
    });
  if (listError) fail(`Supabase could not be read: ${listError.message}`);

  const clash = existingList.users.find(
    u => u.email?.toLowerCase() === email.toLowerCase()
  );

  let authUserId = clash?.id;

  if (!authUserId) {
    const { data: created, error: createError } =
      await supabase.auth.admin.createUser({
        email,
        password: offered || undefined,
        // Confirmed on creation: this is an operator vouching for the address, and
        // a confirmation mail is a step with no security value here.
        email_confirm: true,
        user_metadata: { name },
      });
    if (createError || !created.user) {
      fail(
        `The Supabase identity could not be created: ${createError?.message ?? "no user returned"}`
      );
    }
    authUserId = created.user.id;
    console.log(`[bootstrap] Created the Supabase identity for ${email}.`);
  } else {
    console.log(
      `[bootstrap] A Supabase identity for ${email} already exists; leaving it alone.`
    );
  }

  // The register row, through PostgREST. Keyed on `authUserId`, which is how the
  // request path finds an officer.
  //
  // `Prefer: resolution=ignore-duplicates` rather than a select-then-insert:
  // one round trip instead of two, and it cannot race another bootstrap the way
  // a read followed by a write can.
  const openId = `supabase:${authUserId}`;
  const { error: insertError } = await supabase.from("users").upsert(
    {
      openId,
      name,
      email,
      loginMethod: "supabase",
      username,
      role: "super_admin",
      isActive: true,
      authUserId,
    },
    { onConflict: "authUserId", ignoreDuplicates: true }
  );

  if (insertError) {
    // A failure here leaves an identity that cannot sign in — safe, because the
    // session lookup is by `authUserId` and there is no row to find — but it
    // occupies the address, so say so rather than leaving it to be rediscovered.
    fail(
      `The register row could not be written: ${insertError.message}. The Supabase identity exists but cannot sign in yet; re-run this script and it will write the row.`
    );
  }

  const { data: row, error: readError } = await supabase
    .from("users")
    .select("id, name, email, role, isActive")
    .eq("authUserId", authUserId)
    .maybeSingle();

  if (readError)
    fail(
      `The register row was written but could not be read back: ${readError.message}`
    );
  if (!row)
    fail("The register row was written but reading it back found nothing.");

  console.log(
    `[bootstrap] ${row.email} is id ${row.id} with role ${row.role} and isActive=${row.isActive}.`
  );
  console.log(
    offered
      ? `[bootstrap] Sign in at /login as ${email} with the password you supplied.`
      : `[bootstrap] No password was set. Set one in Supabase under Authentication -> Users, or re-run with SEED_ADMIN_PASSWORD.`
  );
}

main().catch((error: unknown) => {
  console.error("[bootstrap] Failed:", error);
  process.exit(1);
});
