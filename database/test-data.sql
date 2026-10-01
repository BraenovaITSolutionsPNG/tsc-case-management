-- Demonstration data for the TSC Matters register.
--
-- Additive and idempotent, so it is safe to run against a database that already
-- holds matters. Re-running adds nothing: every insert is keyed on a value the
-- table already constrains to be unique, or guarded by a NOT EXISTS that names
-- the row it would otherwise duplicate.
--
-- Every name below is invented. Nothing here describes a real teacher, a real
-- officer, or a real matter. The provinces are used only to exercise the
-- per-province reporting the platform is required to produce.
--
-- Why SQL and not the seed script: this is fixture data for the whole register,
-- not the first account, and it needs to be reviewable before it runs — a
-- hundred rows of inserts that a person has never seen land in a register of
-- disciplinary matters is not something to execute on trust.
--
-- Requires a super administrator, because a matter must have an accountable
-- officer and `createdById` is NOT NULL. Run `pnpm db:seed` first; the check
-- below raises rather than writing a register whose every row is unattributable.
--
-- Run against the direct connection (Supabase 5432), not the transaction pooler.
-- The wrapper is `pnpm db:testdata`, which reads .env the way the rest of the
-- tooling does and runs this file in one transaction.

-- ============================================================================
-- Officers
-- ============================================================================
-- Four more accounts across the tiers, so a demonstration exercises the
-- capability model rather than only its top.
--
-- No `authUserId`. A null is not a broken account: it is an account that cannot
-- sign in until somebody links an identity, and the admin screen shows it as
-- unprovisioned rather than pretending otherwise. Provision these from the admin
-- screen when the people are real, not from here — this file must not create
-- Supabase identities, because it has no way to record the password that would
-- be set and a fixture script holding officer credentials is its own problem.
--
-- `openId` is supplied rather than generated because the column is NOT NULL and
-- unique, and this file has to be re-runnable.
INSERT INTO public."users" ("openId", name, email, username, "loginMethod", role, "isActive")
VALUES
  ('demo:assistant', 'L. Simri',   'l.simri@tsc.gov.pg',   'l.simri',   'supabase', 'assistant',    true),
  ('demo:commissioner','K. Mala',   'k.mala@tsc.gov.pg',   'k.mala',    'supabase', 'commissioner', true),
  ('demo:staff-1',    'P. Bamu',    'p.bamu@tsc.gov.pg',   'p.bamu',    'supabase', 'staff',        true),
  ('demo:staff-2',    'J. Ula',     'j.ula@tsc.gov.pg',    'j.ula',     'supabase', 'staff',        true),
  ('demo:inactive',   'R. Kira',    'r.kira@tsc.gov.pg',   'r.kira',    'supabase', 'staff',        false)
ON CONFLICT ("openId") DO NOTHING;

-- ============================================================================
-- Matters
-- ============================================================================
-- Eleven matters, one per status value, so every column of the register has
-- something in it and the dashboard figures, the weekly brief and the monthly
-- and quarterly reports all have something to count. A register holding one
-- matter makes each of those screens look broken, which is a poor first
-- impression of software that is not broken.
--
-- `matter_type` is written out per row rather than inferred from the summary:
-- it is an enum, so a wrong guess is a failed insert rather than a matter filed
-- under the wrong category. The three values are the whole set, per §2.
--
-- Dates are relative to `now()`, so the reporting windows always have something
-- recent in them: a matter received in 2019 appears in no weekly, monthly or
-- quarterly report. Matter n is received n*9 days ago, which spreads the eleven
-- across the last three months — enough for a monthly report and for the
-- quarter that has just closed to both have something to count.
DO $$
DECLARE
  admin_id integer;
BEGIN
  SELECT id INTO admin_id FROM public."users" WHERE role = 'super_admin' ORDER BY id LIMIT 1;
  IF admin_id IS NULL THEN
    RAISE EXCEPTION
      'No super administrator found. Run pnpm db:seed first — a matter needs an accountable officer.';
  END IF;

  INSERT INTO public."cases" (
    "caseNumber", year, province, "dateReceived", "teacherName",
    "employeeReference", "matterType", "matterSummary",
    "assignedOfficerId", "assignedOfficerName",
    status, "actionRequired", "dueDate", priority, "escalationLevel",
    "decisionRequired", "referredByName", "createdById", "createdByName",
    "receivedByName", "processedByName", "createdAt"
  )
  SELECT
    t.ref,
    2026,
    t.province,
    now() - (row_number() OVER (ORDER BY t.ref) * interval '9 days'),
    t.teacher,
    -- Left null rather than invented. It is the teacher's own staff number, the
    -- one field in this file a made-up value would most easily be mistaken for a
    -- real reference to.
    NULL,
    t.matter_type::matter_type,
    t.summary,
    -- Left join, and the distinction matters. An inner join against this
    -- condition keeps only the two rows that have an officer, because
    -- `openId = NULL` never matches — so the nine unassigned matters, which are
    -- most of the demonstration, would silently not be inserted.
    officer.id,
    officer.name,
    t.status::case_status,
    t.action,
    -- An overdue matter on every urgent one, so the "overdue" filter and the
    -- escalation count on the dashboard have something to find. Relative to now,
    -- so this stays true however long after seeding the file is run.
    CASE WHEN t.priority = 'urgent' THEN now() - interval '2 days'
         ELSE now() + interval '21 days' END,
    t.priority::case_priority,
    t.escalation,
    t.decision_required,
    CASE WHEN t.status IN ('REF','LEG') THEN 'R. Kivuva' END,
    -- The super administrator, not the officer assigned below: the register is
    -- written by whoever received the application, and attributing reception to
    -- the investigating officer would put the wrong name in the accountability
    -- trail on every row.
    admin_id,
    'R. Kivuva',
    'R. Kivuva',
    NULL,
    now() - (row_number() OVER (ORDER BY t.ref) * interval '9 days')
  FROM (VALUES
    -- status, province, teacher, caseNumber, matter type, summary, action, urgency, escalation, needs a decision
    ('NEW',  'NCD',               'Grace Wambui',    'DEMO/TCH/2026/0001', 'Appointment',         'Acting appointment beyond delegated authority',    'Urgent response required on the appointment letter.',          'urgent', 0, false),
    ('VER',  'Morobe',            'Daniel Kava',     'DEMO/TCH/2026/0002', 'Industrial & General', 'Workplace injury claim pending determination',      'Obtain the medical assessment and the incident report.',       'normal', 0, false),
    ('INV',  'Madang',            'Josephine Ula',   'DEMO/TCH/2026/0003', 'Industrial & General', 'Alleged misconduct during a school excursion',     'Interview the teacher and two witnesses.',                      'urgent', 1, false),
    ('REF',  'Central',           'Simon Rombos',    'DEMO/TCH/2026/0004', 'Industrial & General', 'Salary arrears not remitted for two terms',        'Refer to the National Section for recovery advice.',           'normal', 1, false),
    ('ADV',  'Simbu',             'Lucy Kalino',     'DEMO/TCH/2026/0005', 'Legal',               'Advice sought on a contested dismissal',            'Provide the Commission position on notice.',                   'normal', 0, true),
    ('DEC',  'Hela',              'Carolyn Bos',     'DEMO/TCH/2026/0006', 'Legal',               'Matter ready for the Director''s decision',          'Determination required before the sitting.',                   'urgent', 2, true),
    ('LEG',  'East New Britain',  'Peter Bamu',      'DEMO/TCH/2026/0007', 'Legal',               'Legal referral: proceedings issued by a court',      'Legal Section to take carriage. No officer opinion.',          'urgent', 3, false),
    ('ACT',  'Manus',             'Samuel Kira',     'DEMO/TCH/2026/0008', 'Appointment',         'Action agreed: professional development',           'Monitor completion and report at three months.',               'normal', 0, false),
    ('RES',  'Jiwaka',            'Anna Punda',      'DEMO/TCH/2026/0009', 'Appointment',         'Resolved: appointment regularised',                 'None. File for closure.',                                     'normal', 0, false),
    ('CLS',  'Gulf',              'Mary Timbi',      'DEMO/TCH/2026/0010', 'Industrial & General', 'Closed: matter determined and notified',             'None. Complete the case file.',                               'normal', 0, false),
    ('ESC',  'Western Highlands', 'Andrew Kuman',    'DEMO/TCH/2026/0011', 'Industrial & General', 'Escalated: unresolved beyond the provincial office', 'Escalated to the Commission under §14.',                      'urgent', 6, true)
  ) AS t(status, province, teacher, ref, matter_type, summary, action, priority, escalation, decision_required)
  LEFT JOIN public."users" officer
    ON officer."openId" = CASE t.status
         WHEN 'VER'  THEN 'demo:staff-1'
         WHEN 'INV'  THEN 'demo:staff-2'
         ELSE NULL  -- unassigned: the officer pool, which the dashboard counts
       END
  ON CONFLICT ("caseNumber") DO NOTHING;

  -- Closure dates, for the two matters that are finished. A closed matter with no
  -- date is a register that cannot answer "how long did this take".
  UPDATE public."cases"
     SET "dateClosed" = now() - interval '3 days'
   WHERE "caseNumber" LIKE 'DEMO/%' AND status IN ('RES','CLS');

  -- Referral dates, matching the `referredAt` the referrals below carry.
  UPDATE public."cases"
     SET "dateReferred"   = now() - interval '4 days',
         "dateReferredAt" = now() - interval '4 days'
   WHERE "caseNumber" LIKE 'DEMO/%' AND status IN ('REF','LEG');

  -- The outcome on the two that are finished, because "closed" and "resolved"
  -- with an empty outcome is the one state a register should never really hold
  -- and a demonstration should not show.
  UPDATE public."cases"
     SET "outcome" = CASE
           WHEN status = 'RES' THEN 'Appointment regularised by the Director; the teacher resumed duty without penalty.'
           WHEN status = 'CLS' THEN 'Matter determined and the teacher notified in writing. Case file complete.'
         END
   WHERE "caseNumber" LIKE 'DEMO/%' AND status IN ('RES','CLS');

  -- §12C case brief on the matter flagged for the Director, so the brief screen
  -- has the five headings filled in rather than five empty boxes.
  UPDATE public."cases"
     SET "briefIssue" = 'Whether the contested dismissal was within the delegated authority of the provincial office.',
         "briefBackground" = 'The teacher was dismissed on 14 May 2026 following an incident during a school excursion. The employer relied on a provision the provincial office does not hold.',
         "briefActionTaken" = 'The dismissal letter and the incident report were obtained and the two witnesses interviewed. Advice was sought from the Legal Section.',
         "briefCurrentPosition" = 'The provincial office considers the dismissal not within delegation. The matter is properly one for the Commission.',
         "briefIssueRequiringDecision" = 'Whether to confirm the dismissal, or refer the matter back for a fresh process.',
         "briefRecommendation" = 'Refer to the Commission. The provincial office has no power to determine the appeal.',
         "briefPreparedByName" = 'R. Kivuva',
         "briefPreparedAt" = now() - interval '2 days'
   WHERE "caseNumber" = 'DEMO/TCH/2026/0005';
END $$;

-- ============================================================================
-- Events
-- ============================================================================
-- A worked timeline on one matter, so the detail screen has a history to read
-- rather than a single "received" line. This is the shape an officer actually
-- reads: received, acknowledged, documents called for, investigation,
-- determination. Written under the super administrator so `actorId` resolves.
DO $$
DECLARE
  admin_id integer;
  target  integer;
BEGIN
  SELECT id INTO admin_id FROM public."users" WHERE role = 'super_admin' ORDER BY id LIMIT 1;
  SELECT id INTO target FROM public."cases" WHERE "caseNumber" = 'DEMO/TCH/2026/0003';

  IF target IS NULL THEN
    RETURN;  -- the matter was not inserted (already present under another state)
  END IF;

  INSERT INTO public."caseEvents" ("caseId", "eventType", note, "actorId", "actorName", "createdAt")
  SELECT target, e.event_type, e.note, admin_id, 'R. Kivuva', now() - (e.age || ' days')::interval
    FROM (VALUES
      ('case_received',   'Application received from the Director of the school. Copied to the officer.',  9),
      ('status_change',   'Acknowledged and entered in the central register.',                            8),
      ('document',        'Called for the incident report and the two witness statements.',               6),
      ('status_change',   'Investigation opened. Officer assigned.',                                       5),
      ('document',        'Incident report received. Two witness statements outstanding.',                 3),
      ('advice_received', 'Legal Section advice received: the matter engages a provision outside delegation.', 2),
      ('status_change',   'Referred to the Legal Section for carriage.',                                  1)
    ) AS e(event_type, note, age)
   WHERE NOT EXISTS (
     SELECT 1 FROM public."caseEvents" x
      WHERE x."caseId" = target AND x.note = e.note
   );

  -- One event on every other demonstration matter, so the audit trail on the
  -- admin screen is not a single row and "matters this officer acted on" counts
  -- something.
  INSERT INTO public."caseEvents" ("caseId", "eventType", note, "actorId", "actorName", "createdAt")
  SELECT c.id, 'case_received',
         'Application received and entered in the central register.',
         admin_id, 'R. Kivuva', c."dateReceived"
    FROM public."cases" c
   WHERE c."caseNumber" LIKE 'DEMO/%'
     AND NOT EXISTS (
       SELECT 1 FROM public."caseEvents" x WHERE x."caseId" = c.id
     );
END $$;

-- ============================================================================
-- Referrals
-- ============================================================================
-- Two, one of each kind in §5. The legal one takes the Legal Section path and
-- records the Director's notification, which §6 requires and which the referral
-- screen shows; the Industrial and General one carries the §8 statement set,
-- without which that referral cannot be closed out.
DO $$
DECLARE
  admin_id integer;
  legal_case integer;
  ig_case    integer;
BEGIN
  SELECT id INTO admin_id FROM public."users" WHERE role = 'super_admin' ORDER BY id LIMIT 1;
  SELECT id INTO legal_case FROM public."cases" WHERE "caseNumber" = 'DEMO/TCH/2026/0007';
  SELECT id INTO ig_case    FROM public."cases" WHERE "caseNumber" = 'DEMO/TCH/2026/0004';

  IF legal_case IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."referrals" WHERE "caseId" = legal_case
  ) THEN
    INSERT INTO public."referrals" (
      "caseId", destination, reason, criteria, "isLegal",
      "directorNotifiedName", "directorNotifiedAt",
      "referredAt", "responseDueDate", "referredById", "referredByName", status
    ) VALUES (
      legal_case,
      'Legal Section, Head Office',
      'Proceedings have been issued by the Provincial Court. Legal Section to take carriage and advise on representation.',
      'court_proceedings,legislation',
      true,
      'R. Kivuva',
      now() - (interval '4 days'),
      now() - (interval '4 days'),
      now() + (interval '11 days'),
      admin_id,
      'R. Kivuva',
      'pending'
    );
  END IF;

  IF ig_case IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."referrals" WHERE "caseId" = ig_case
  ) THEN
    INSERT INTO public."referrals" (
      "caseId", destination, reason, criteria, "isLegal",
      "referredAt", "responseDueDate",
      "statementClaim", "statementVerified", "statementUnresolved", "statementAdviceRequired",
      "referredById", "referredByName", status
    ) VALUES (
      ig_case,
      'National Section, Finance',
      'Salary arrears for two terms not remitted. Recovery advice and the correct procedure sought.',
      'industrial_dispute,statutory_entitlement',
      false,
      now() - (interval '5 days'),
      now() + (interval '12 days'),
      'Two terms of salary, totalling K12,400, remain unpaid.',
      'The employer has confirmed the arrears in writing and does not dispute the sum.',
      'Whether the employer may withhold pending an internal grievance.',
      'Recovery is not subject to the grievance. Direct the employer to remit.',
      admin_id,
      'R. Kivuva',
      'pending'
    );
  END IF;
END $$;

-- ============================================================================
-- Case file
-- ============================================================================
-- §11 asks for a complete case file, and the closure checklist reads these
-- classes. Logged-only entries: `fileKey` is null, so nothing is stored in the
-- object store and there is no file to go missing.
--
-- The class keys are the ones in `DOCUMENT_CLASSES` (shared/delegation.ts), and
-- they must be: the detail screen looks each entry's key up there for its label
-- and falls back to printing the raw key, so an invented one renders as
-- "determination_letter" in a register of teacher matters. `shared` is the single
-- source of truth for the list, so the checklist on screen and the fixture agree.
--
-- The closed matter is given every class the closure checklist requires, which
-- is what "complete" means there: original_application, decisions,
-- communication_to_teacher and closure_record.
DO $$
DECLARE
  admin_id integer;
BEGIN
  SELECT id INTO admin_id FROM public."users" WHERE role = 'super_admin' ORDER BY id LIMIT 1;

  INSERT INTO public."caseDocuments" ("caseId", "documentClass", title, note, "loggedById", "loggedByName", "createdAt")
  SELECT c.id, d.doc_class, d.title, 'Logged for demonstration. No file is attached to this entry.',
         admin_id, 'R. Kivuva', c."dateReceived"
    FROM public."cases" c
    CROSS JOIN (VALUES
      ('original_application',   'Original application / query'),
      ('supporting_documents',   'Supporting documents'),
      ('correspondence_received','Correspondence received'),
      ('correspondence_sent',    'Correspondence sent'),
      ('investigation_notes',    'Investigation notes'),
      ('relevant_records',       'Relevant records'),
      ('referral_letter',        'Referral letter'),
      ('advice_received',        'Advice received'),
      ('decisions',              'Decisions'),
      ('communication_to_teacher','Evidence of communication to the teacher'),
      ('closure_record',         'Closure record')
    ) AS d(doc_class, title)
   WHERE c."caseNumber" LIKE 'DEMO/%'
     -- Every class on the open matters, so the file view has something in each
     -- section; on the closed matter only the closure checklist, so "complete"
     -- is a real state this file produces rather than a claim.
     AND (c.status <> 'CLS'
          OR d.doc_class IN ('original_application','decisions','communication_to_teacher','closure_record'))
     AND NOT EXISTS (
       SELECT 1 FROM public."caseDocuments" x
        WHERE x."caseId" = c.id AND x."documentClass" = d.doc_class
     );
END $$;

-- ============================================================================
-- Report
-- ============================================================================
DO $$
DECLARE
  c integer;
  e integer;
  r integer;
  d integer;
BEGIN
  SELECT count(*) INTO c FROM public."cases"  WHERE "caseNumber" LIKE 'DEMO/%';
  SELECT count(*) INTO e FROM public."caseEvents";
  SELECT count(*) INTO r FROM public."referrals";
  SELECT count(*) INTO d FROM public."caseDocuments";
  IF c <> 11 THEN
    RAISE EXCEPTION
      'Expected 11 demonstration matters, found %. The matter insert is not producing every status.', c;
  END IF;
  RAISE NOTICE
    '[test-data] % demonstration matters, % events, % referrals, % case-file entries. Re-running this file adds nothing.',
    c, e, r, d;
END $$;
