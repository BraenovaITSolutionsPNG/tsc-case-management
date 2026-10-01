-- Link an administrator whose Supabase identity you created by hand.
--
-- For the case where the one administrator is added through Supabase's own
-- dashboard (Authentication -> Users -> Add user) rather than by `pnpm db:seed`.
--
-- Why this exists at all: `auth.me` resolves an officer by `users.authUserId`, so
-- a Supabase user with no row here can never sign in — and creating that row is
-- all that stands between them and the platform. Doing it by hand needs no
-- service-role key: this is a plain INSERT on the application's own connection,
-- whereas `pnpm db:seed` needs the service role because it has to create the
-- Supabase identity too. So the two routes split cleanly:
--
--   Identity in Supabase + this file  -> no service role anywhere
--   `pnpm db:seed`                   -> creates both, needs the service role
--
-- Run it in the Supabase SQL Editor, or against a reachable DATABASE_URL with
-- psql.
--
-- Before running: replace the three TODOs. The uuid is under Authentication ->
-- Users -> the user; it is the reference shown at the top of that row, and the
-- last path segment of the URL.
DO $$
DECLARE
  auth_uuid   text := 'TODO_AUTH_USER_UUID';
  admin_email text := 'TODO_ADMIN_EMAIL';
  admin_name  text := 'Platform Administrator';
BEGIN
  IF auth_uuid LIKE 'TODO%' OR admin_email LIKE 'TODO%' THEN
    RAISE EXCEPTION 'Replace the TODO values at the top of this script first.';
  END IF;

  -- The guard is here rather than left to a constraint because there is no
  -- constraint to leave it to: only `authUserId` and `openId` are unique, so
  -- running this twice with a second uuid and the same address would create a
  -- *second* super administrator for one person, and both would hold every
  -- capability. The uuid case is caught by the unique index anyway; the address
  -- case is not, which is why it is checked.
  IF EXISTS (SELECT 1 FROM public."users" WHERE "authUserId" = auth_uuid) THEN
    RAISE EXCEPTION 'A register row already exists for the Supabase user %. Nothing to do.', auth_uuid;
  END IF;

  IF EXISTS (SELECT 1 FROM public."users" WHERE lower(email) = lower(admin_email)) THEN
    RAISE EXCEPTION 'The address % already has a register row. Approve or promote that one instead of creating another.', admin_email;
  END IF;

  INSERT INTO public."users" ("openId", name, email, "loginMethod", role, "authUserId")
  VALUES ('supabase:' || auth_uuid, admin_name, admin_email, 'supabase', 'super_admin', auth_uuid);

  RAISE NOTICE 'Linked %. Sign in as that address with the password you set in Supabase.', admin_email;
END $$;
