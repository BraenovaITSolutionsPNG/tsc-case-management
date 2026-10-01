import { defineConfig } from "drizzle-kit";
import { databaseCredentials } from "./server/_core/databaseConnection";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // The same credentials the request path uses, TLS included, so a migration
  // cannot fail against a database the app can reach or succeed against one it
  // cannot. The `{ url }` form drizzle-kit also accepts cannot carry a CA
  // certificate, which is what a hosted database needs.
  //
  // Migrations must run against the *direct* connection (Supabase's 5432), not
  // the transaction pooler on 6543: DDL needs a session, and the pooler discards
  // one between transactions. Set DATABASE_URL to the 5432 string when running
  // `pnpm db:push`; the application's own pool may use 6543.
  dbCredentials: databaseCredentials(),
});
