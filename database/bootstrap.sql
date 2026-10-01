-- PostgreSQL bootstrap for the TSC Case Management platform.
--
-- Creates the application role and grants it the schema. Safe to re-run: every
-- statement is IF NOT EXISTS / idempotent.
--
--   psql -U postgres < database/bootstrap.sql
--
-- The password below is the development default and must match DATABASE_URL in
-- .env. It is deliberately not a secret: this file exists so a developer can
-- reproduce the local database, not to hold production credentials. Use a
-- generated secret and an environment-injected password for any real deployment.
--
-- Verified against PostgreSQL 17.

-- The database itself is created by the container's POSTGRES_DB, which runs
-- before this file. What is left is the role the application connects as, which
-- is kept separate from the superuser so the app cannot create databases, roles
-- or extensions.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tsc') THEN
    CREATE ROLE tsc LOGIN PASSWORD 'tsc_dev_password';
  END IF;
END
$$;

-- CREATE on the database, not just CONNECT: `drizzle-kit migrate` runs
-- `CREATE SCHEMA IF NOT EXISTS "drizzle"` to keep its migration journal, and
-- creating a schema is a database-level privilege rather than a schema-level
-- one. Without it the first migration fails with "permission denied for
-- database tsc_case_management" before any application table is attempted.
--
-- On Supabase this is already true of the `postgres` role, which is the role
-- its connection strings use, so this file's grants matter only for the local
-- service.
GRANT CONNECT, CREATE ON DATABASE tsc_case_management TO tsc;

-- Schema-level rights. The tables are created by the migrations, which run as
-- whichever role holds DATABASE_URL, so `tsc` needs to be able to create them
-- in a fresh database.
GRANT USAGE, CREATE ON SCHEMA public TO tsc;

-- Note on timezones: the app stores and reads every timestamp through
-- node-postgres/drizzle and does its own date arithmetic in JS. A `timestamp`
-- column (without time zone) carries no zone of its own, so the values it holds
-- are exactly the instants the app wrote — unlike MySQL's `timestamp`, which
-- converted on the server's zone. Keep this in mind when reading a value out of
-- the database by hand: it is UTC as written, and `SELECT now()` is in the
-- server's zone.
