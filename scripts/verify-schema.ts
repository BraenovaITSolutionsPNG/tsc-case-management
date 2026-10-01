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
}

main().catch(error => {
  console.error("[schema] Could not read the schema:", error);
  process.exit(1);
});
