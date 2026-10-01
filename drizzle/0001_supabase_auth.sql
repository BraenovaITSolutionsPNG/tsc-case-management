-- Supabase Auth owns the credential; this table keeps the register row.
--
-- Two changes, in this order, and the order is the safe one:
--
--   1. Add "authUserId" as a nullable, unique column. Nullable so this can be
--      applied before the Supabase identities exist, and so a row can be
--      created and its identity set up afterwards. A null is never a sign-inable
--      state — the request path looks an officer up *by* this column, so a null
--      row is simply unreachable.
--
--   2. Drop "passwordHash". The scrypt hashes that were here cannot be
--      converted to Supabase's format, and keeping a column that nothing reads
--      invites a future contributor to write a credential into a system whose
--      sign-in path would never verify it.
--
-- Deliberately NOT done here: rewriting "openId". The new column is the join,
-- and "openId" is left exactly as it is because the audit log and the case
-- register reference officers by it. Changing the values that history was
-- written against would break the accountability trail §15 requires.
ALTER TABLE "users" ADD COLUMN "authUserId" varchar(36);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_authUserId_unique" UNIQUE("authUserId");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "passwordHash";--> statement-breakpoint
-- ===========================================================================
-- Row level security, on every table, with no policies.
-- ===========================================================================
-- Part of the same migration as the identity change because it is the same
-- change: Supabase puts an anon key in every browser by design, and that key is
-- a public value. Before Auth, the platform's own session cookie was the only
-- thing an anonymous visitor lacked, so the tables were safe by virtue of the
-- app never exposing a database path to a browser. After it, the anon key is
-- aimed straight at this database, and anything it can reach is readable by
-- anyone who has the key — no sign-in required.
--
-- So RLS goes on every table, and no policy is created. That is the intended
-- shape, not an oversight:
--
--   - The application never talks to the database as `anon` or `authenticated`.
--     It reads and writes over one privileged connection as the table owner —
--     `postgres` on Supabase, `tsc` locally — and PostgreSQL exempts the owner
--     from row security, so every existing screen keeps working unchanged.
--   - PostgREST is reachable with the anon key, and with RLS on and no policy
--     every role it can authenticate as is denied. The register — teacher
--     names, matter files, disciplinary records — is not readable through the
--     public API. Verified against this schema: a non-owner role holding an
--     explicit SELECT grant reads 0 rows from "cases", while the owner reads
--     every row.
--
-- Deliberately NOT `FORCE ROW LEVEL SECURITY`. That would also bind the table
-- owner, and this deployment reads the database as the owner on purpose: every
-- capability check lives in shared/access.ts and is enforced in application
-- code, which is where it can be tested. A policy that silently filtered rows
-- out from under those checks would be a second, invisible source of truth
-- about who may see a matter.
--
-- The dependency this creates, stated so it is not discovered the hard way:
-- the role the application connects as must be the role that applied the
-- migrations, or row security applies to the app and every screen returns
-- nothing. Nothing in the request path reports that as a permissions problem,
-- so it would present as an empty register.
--
-- `scripts/verify-schema.ts` asserts this state, so a database where RLS has
-- been switched off fails a deployment rather than running wide open.
--
-- The identifiers are quoted, as they are in 0000. PostgreSQL folds an unquoted
-- name to lower case, so an unquoted `caseDocuments` would not name the table
-- that exists; it would name one that does not, and the statement would succeed
-- without turning anything on.
ALTER TABLE "cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "caseEvents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "caseDocuments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "referrals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;