import { defineConfig } from "drizzle-kit";
import { databaseCredentials } from "./server/_core/databaseConnection";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  // The same credentials the request path uses, TLS included, so a migration
  // cannot fail against a database the app can reach or succeed against one it
  // cannot. The `{ url }` form drizzle-kit also accepts cannot carry a CA
  // certificate, which is what a hosted database needs.
  dbCredentials: databaseCredentials(),
});
