// First, and for the same reason as server/seed.ts: `next dev` loads .env
// itself, a plain `tsx` script does not, and the connection is built from the
// environment when it is asked for rather than at import time.
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  databaseCredentials,
  describeTls,
} from "../server/_core/databaseConnection";

/**
 * Did the schema actually land?
 *
 * A migration command that exits zero says the DDL was accepted. It does not
 * say the tables are the ones the application reads, and the two come apart in
 * the failure that matters most: migrating the wrong database, or migrating a
 * database that a previous run already partly populated. Both leave a green
 * job and a broken app, because the app's first query is a `SELECT` against a
 * table that is not there and the error a user sees is about a screen, not
 * about a deploy.
 *
 * So this asks the database what it holds, and names what it found. It reports
 * how the connection is secured for the same reason seed.ts does: the question
 * it is really being asked is whether the right database was reached, and
 * "Connected" alone does not say.
 */
async function main() {
  const db = drizzle({ connection: databaseCredentials() });
  // `current_schema()` rather than a literal 'public': the schema holding the
  // application's tables is whichever one the connection resolves to, and
  // hardcoding 'public' would report an empty list against a project configured
  // otherwise — a false "schema not applied" for a database that is fine.
  const result = await db.execute(sql`
    SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
    ORDER BY table_name`);
  // node-postgres hands back a QueryResult whose `rows` are the result set. The
  // MySQL driver returned a bare array, which is why this is not one.
  const tables = (result as unknown as { rows: { name: string }[] }).rows.map(
    row => row.name
  );

  console.log(`[schema] connected over ${describeTls()}`);
  console.log(
    `[schema] ${tables.length} tables: ${tables.join(", ") || "none"}`
  );

  // The two the application cannot start without: one is every account, the
  // other every matter. Checking the whole list is a report; checking these is
  // an assertion.
  const required = ["users", "cases"];
  const missing = required.filter(table => !tables.includes(table));
  if (missing.length) {
    console.error(
      `[schema] Missing: ${missing.join(", ")}. The schema has not been applied to this database. Run pnpm db:push against it.`
    );
    process.exit(1);
  }
  console.log(`[schema] ${required.join(" and ")} are present.`);

  // The credential column must be gone.
  //
  // Not a cosmetic check. `passwordHash` held scrypt hashes that nothing can
  // verify any more, because Supabase holds the credential now — so leaving the
  // column means leaving a copy of every officer's old password in a table whose
  // contents are readable by anything that reaches the database. Its presence
  // is the single clearest sign that a migration predating the move to Supabase
  // has been applied to a database that has moved on.
  const credentialColumn = await db.execute(sql`
    SELECT column_name AS name FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'users'
      AND column_name = 'passwordHash'`);
  if (
    (credentialColumn as unknown as { rows: { name: string }[] }).rows.length
  ) {
    console.error(
      '[schema] users.passwordHash still exists. The stored credential is no longer read by anything, and it should not be left in the table. Run pnpm db:push to apply 0001_supabase_auth.'
    );
    process.exit(1);
  }

  // ...and the Supabase link must be there. A database without it has no
  // sign-inable account, which presents as every officer being refused at the
  // front door rather than as a schema problem.
  const linkColumn = await db.execute(sql`
    SELECT column_name AS name FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'users'
      AND column_name = 'authUserId'`);
  if (!(linkColumn as unknown as { rows: { name: string }[] }).rows.length) {
    console.error(
      '[schema] users.authUserId is missing, so no account can be linked to a Supabase identity. Run pnpm db:push.'
    );
    process.exit(1);
  }
  console.log(
    "[schema] users carries authUserId and no stored credential."
  );

  // Row level security.
  //
  // The application reads the database server-side with a privileged connection
  // and does not go through PostgREST, so RLS is not what protects the register
  // in normal operation. It is what protects it against everything else: the
  // anon key is a public value by design and is present in every browser, and
  // with RLS off, that key is a way to read the whole case register without
  // signing in at all.
  //
  // A table can also have RLS enabled with no policies, which denies everything
  // to anon and authenticated — that is the intended state here, and the
  // count below reports it rather than failing on it. A non-zero policy count is
  // worth a human look: a policy on the register's tables is a decision nobody
  // in this codebase made.
  const rls = await db.execute(sql`
    SELECT c.relname AS name, c.relrowsecurity AS enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = current_schema() AND c.relkind = 'r'
    ORDER BY c.relname`);
  const tablesWithoutRls = (
    rls as unknown as { rows: { name: string; enabled: boolean }[] }
  ).rows
    .filter(row => !row.enabled)
    .map(row => row.name);
  if (tablesWithoutRls.length) {
    console.error(
      `[schema] Row level security is OFF on: ${tablesWithoutRls.join(", ")}. With the public anon key in every browser, these tables are readable by anyone who can reach the API. Enable RLS and add no policies.`
    );
    process.exit(1);
  }

  const policies = await db.execute(sql`
    SELECT count(*)::int AS count FROM pg_policies
    WHERE schemaname = current_schema()`);
  const policyCount = (
    policies as unknown as { rows: { count: number }[] }
  ).rows[0]?.count;
  console.log(
    `[schema] RLS is enabled on all ${(
      rls as unknown as { rows: unknown[] }
    ).rows.length} tables, with ${policyCount} policies. No policies is correct: every read goes through the server.`
  );
}

main().catch(error => {
  console.error("[schema] Could not read the schema:", error);
  process.exit(1);
});
