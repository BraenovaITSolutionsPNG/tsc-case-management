// First, and for the same reason as server/seed.ts: `next dev` loads .env
// itself, a plain `tsx` script does not, and the connection is built from the
// environment when it is asked for rather than at import time.
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "pg";
import {
  databaseCredentials,
  describeTls,
} from "../server/_core/databaseConnection";

/**
 * Load `database/test-data.sql`.
 *
 * A thin wrapper around psql, and the reason for it is `.env`. The README's
 * one-liner is `psql "$DATABASE_URL" ...`, which only works if DATABASE_URL is
 * exported in the shell — and it is not, because it lives in a file that
 * dotenv reads and nothing parses. So the documented command fails on a machine
 * set up correctly, which is worse than having no command at all: it looks like
 * the script is broken rather than like the invocation is.
 *
 * This reads the same `.env` as everything else and connects the same way, so
 * `pnpm db:testdata` means the same thing as `pnpm db:push`.
 */
const here = dirname(fileURLToPath(import.meta.url));
const SQL_FILE = join(here, "..", "database", "test-data.sql");

async function main() {
  const credentials = databaseCredentials();

  // Reported before the load, not after: the question this answers is always
  // "did it go into the database I meant?", and that is worth settling before the
  // answer is "it did not".
  console.log(`[test-data] connected over ${describeTls()}`);

  const client = new Client(credentials);

  // The SQL file ends with a RAISE NOTICE reporting what it loaded, and it is
  // the only confirmation that the load did what it claims. pg discards notices
  // unless a handler is attached, so without this the script prints its
  // connection line and then nothing — which reads as though it did not run.
  client.on("notice", notice => {
    if (notice.message) console.log(notice.message.trim());
  });

  await client.connect();
  try {
    const sql = await readFile(SQL_FILE, "utf8");

    // One transaction, so a failure partway leaves the database as it was rather
    // than half populated. The file's own RAISE EXCEPTION for a missing
    // administrator lands here too, and is reported as the failure it is.
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {
        // The connection may already be unusable. The original error below is
        // the one worth reading.
      });
      throw error;
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error("[test-data] Could not load the demonstration data:", error);
  process.exit(1);
});
