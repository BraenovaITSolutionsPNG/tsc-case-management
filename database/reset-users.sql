-- Remove every account from the register. Everything else is left alone.
--
-- For clearing test accounts out of a Supabase project. It does NOT touch
-- drizzle/__drizzle_migrations, the enums, or the table definitions: it empties
-- `users` and nothing else, so the platform's schema survives and the next
-- administrator can sign in and recreate the officers.
--
-- Read the consequences before running it. This is not reversible — there is no
-- backup of a Supabase project in this repository.
--
--   1. Every account stops existing, including any super administrator. The
--      platform then has nobody who can create an account, because the admin
--      screen is behind a capability only an administrator holds. The way back
--      in is `pnpm admin:bootstrap` or database/link-admin.sql. Nothing else
--      does.
--
--   2. Matters are NOT deleted, and they name the officers who registered them.
--      `cases.createdById` is not a foreign key — the schema has no constraints
--      between these tables — so the delete succeeds and leaves that column
--      pointing at rows that no longer exist. A matter would then be attributed
--      to an officer the register cannot resolve: `getUserById` returns nothing
--      where the accountability trail expects somebody.
--
--      That is why the script counts referencing matters first and refuses when
--      there are any. If you want a genuinely empty register, delete the matters
--      too — the second block below does both, in the order that keeps every
--      reference valid while it runs.
--
-- Run in the Supabase SQL Editor. Nothing happens until `confirm` is set to
-- true, so it is safe to paste and read first.
DO $$
DECLARE
  -- Flip to true to actually delete. Left false so the script cannot be run by
  -- accident by pasting it and hitting Run.
  confirm        boolean := false;
  account_count  integer;
  -- Matters naming an officer, counted across every column that does. Not
  -- "matters already orphaned" — deleting every account orphans every matter
  -- that names one, so the question is whether any matter names an officer at
  -- all, before the delete rather than after it.
  matters        integer;
  events         integer;
  referrals      integer;
  documents      integer;
BEGIN
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'There is no public.users table. Has the schema been applied? Run pnpm db:sql first.';
  END IF;

  SELECT count(*) INTO account_count FROM public."users";
  SELECT count(*) INTO matters   FROM public."cases" WHERE "createdById" IS NOT NULL;
  SELECT count(*) INTO events    FROM public."caseEvents"  WHERE "actorId" IS NOT NULL;
  SELECT count(*) INTO referrals FROM public."referrals"   WHERE "referredById" IS NOT NULL;
  SELECT count(*) INTO documents FROM public."caseDocuments" WHERE "loggedById" IS NOT NULL;

  RAISE NOTICE
    'There are % account(s). % matter(s), % event(s), % referral(s) and % case-file entry(ies) name an officer.',
    account_count, matters, events, referrals, documents;

  IF NOT confirm THEN
    RAISE EXCEPTION
      'Nothing was deleted. Set confirm to true and run again. To wipe the register too, use the second block in this file.';
  END IF;

  IF matters + events + referrals + documents > 0 THEN
    RAISE EXCEPTION
      'Nothing was deleted. % row(s) in the register name an officer, and removing every account would leave all of them pointing at rows that no longer exist. Use the second block in this file, which removes the register first and in the right order.',
      matters + events + referrals + documents;
  END IF;

  DELETE FROM public."users";

  RAISE NOTICE 'Removed % account(s). The schema is untouched.', account_count;
  RAISE NOTICE
    'There is now no administrator. Create one with: pnpm admin:bootstrap (or database/link-admin.sql).';
END $$;


-- ===========================================================================
-- Second block: a genuinely empty register — matters and accounts both.
-- ===========================================================================
-- Nothing above this line runs unless you paste it separately.
--
-- Order matters and it is the reverse of the dependency: the register names
-- officers, so the matters go first and the accounts second. Deleting the
-- accounts first would leave matters pointing at nothing, which is the failure
-- the first block refuses to perform.
--
-- Run this INSTEAD of the block above, not as well as it.
DO $$
DECLARE
  confirm        boolean := false;   -- flip to true to actually delete
  doc_count      integer;
  event_count    integer;
  referral_count integer;
  matter_count   integer;
  account_count  integer;
BEGIN
  IF to_regclass('public.cases') IS NULL THEN
    RAISE EXCEPTION 'There is no public.cases table. Has the schema been applied?';
  END IF;

  SELECT count(*) INTO matter_count   FROM public."cases";
  SELECT count(*) INTO event_count    FROM public."caseEvents";
  SELECT count(*) INTO referral_count FROM public."referrals";
  SELECT count(*) INTO doc_count      FROM public."caseDocuments";
  SELECT count(*) INTO account_count  FROM public."users";

  RAISE NOTICE
    'About to remove % matter(s), % event(s), % referral(s), % case-file entry(ies) and % account(s).',
    matter_count, event_count, referral_count, doc_count, account_count;

  IF NOT confirm THEN
    RAISE EXCEPTION 'Nothing was deleted. Set confirm to true and run again.';
  END IF;

  -- Children before parents, for the same reason as above: each of these is
  -- named by a matter, and a matter is named by an officer.
  DELETE FROM public."caseDocuments";
  DELETE FROM public."caseEvents";
  DELETE FROM public."referrals";
  DELETE FROM public."cases";
  DELETE FROM public."users";

  RAISE NOTICE 'The register is empty and there is no administrator.';
  RAISE NOTICE 'Create one with: pnpm admin:bootstrap (or database/link-admin.sql).';
END $$;
