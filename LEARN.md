# LEARN.md — How the TSC Provincial Matters platform works

A reading guide for anyone new to this codebase or to the office it serves: what
the system is, how a request moves through it, what each role can do, and how a
matter travels from a teacher's letter to a closed file.

Every claim here is traceable to a file. Where a rule is enforced in code, the
file is named, so you can go read the actual mechanism rather than trust this
summary. Nothing here replaces the Provincial Matters Administration Manual —
the manual is the authority, the code is its enforcement.

---

## 1. What this system is

A case management platform for a **Provincial Matters office**: the office that
receives complaints and queries about teachers, registers each one as a _matter_,
works it through a fixed sequence of stages, refers the parts that exceed
provincial authority to National TSC sections, records what comes back, and
reports on the whole caseload.

It is a workflow system, not a document store. The central design commitment is
that **the register is the truth**. Reports, returns and compliance figures are
all counted from what is on the register at the moment they are run — never from
a separate tally that could disagree with it. If a matter is not on the register,
it did not happen.

### A note on naming

Two descriptions of the deploying body exist in the repository and they disagree:
`IDEA.md` describes the **Kenya** Teachers Service Commission, while
`shared/validation.ts` refers to a **Papuan New Guinea** "Commission" and
"provincial secretary". Both are cosmetic — no logic depends on either — but
neither is authoritative and one should be chosen before this goes to an office.
Worth settling early, because it appears in user-facing copy.

### Stack

| Layer       | Choice                                                | Where                                |
| ----------- | ----------------------------------------------------- | ------------------------------------ |
| Framework   | Next.js 16, App Router, React 19                      | `app/`                               |
| API         | tRPC over a route handler                             | `server/routers.ts`, `app/api/trpc/` |
| Client data | TanStack Query, dehydrated from the server            | `client/src/lib/trpc.ts`             |
| Database    | PostgreSQL via Drizzle ORM                            | `server/db.ts`, `drizzle/schema.ts`  |
| Identity    | Supabase Auth (this app holds no signing key)         | `server/_core/supabaseSession.ts`    |
| Files       | S3 / Supabase Storage, proxied through `/files/{key}` | `server/storage.ts`                  |
| Rules       | Pure TypeScript in `shared/`, imported by both sides  | `shared/`                            |
| Tests       | Vitest, 257 tests across 21 files                     | `*.test.ts`                          |

---

## 2. How the site works

### 2.1 The rules live in `shared/`, and both sides import them

This is the single most important architectural fact. `shared/` contains no
React and no database code — only rules, expressed as pure functions:

| File                    | What it holds                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `shared/access.ts`      | The 5 roles, the ~20 capabilities, and `can()` / `canAny()`                                     |
| `shared/roles.ts`       | Role labels, full job titles, plain-language descriptions                                       |
| `shared/statuses.ts`    | The 11 status codes, which are open, which are closed                                           |
| `shared/matters.ts`     | Matter classes, provinces, and how a class implies a default National Section                   |
| `shared/delegation.ts`  | Document classes, escalation levels, the case brief's fields, **and the §17 Golden Rule check** |
| `shared/validation.ts`  | Input schemas and every refusal message an officer can be shown                                 |
| `shared/pagination.ts`  | Page arithmetic and the page sizes                                                              |
| `shared/queryClient.ts` | Refetch and retry policy                                                                        |

The server imports these to **enforce**; the client imports the same functions to
**decide what to show**. A status added in `shared/statuses.ts` appears in every
dropdown, every filter and every validator without a second edit. The upside is
that the UI cannot offer an action the server will refuse.

The trade-off is stated in `shared/access.ts` and worth understanding: capability
sets are written **out in full** per role and deliberately do _not_ inherit by
array order. Promoting someone is therefore always a deliberate edit rather than a
side effect of list position — but it also means a capability added to a senior
role is not automatically given to a more senior one.

### 2.2 What happens when an officer opens a page

```
Browser requests /cases
  └─ app/cases/page.tsx        (a Server Component)
       ├─ getServerTrpc()      builds a caller bound to this request's cookies
       ├─ requireSession()     resolves the officer, or redirects to /login
       ├─ prefetch()           runs the queries and puts them in the cache
       └─ HydrationBoundary    hands that cache to the browser
            └─ client/src/views/CaseRegister.tsx renders with data already present
```

Two consequences worth internalising:

- **A signed-out officer never receives the screen.** The guard runs on the
  server, so there is no flash of a protected page and no signed-out shell to
  correct afterwards. That is also why protected routes use `force-dynamic`.
- **Data arrives before paint**, because the query cache is serialised into the
  HTML. This is why the page-load timings quoted in the pool-sizing comments are
  measured this way.

### 2.3 How a request is authenticated

Supabase Auth owns the credential. This application never signs a token, stores a
password, or holds a signing key. The join is one column: `users.authUserId`.

`server/_core/supabaseSession.ts` resolves the caller on **every** request, in
this order — and the order is the whole authorization story:

1. **No session is not an error.** Public procedures must work for an anonymous
   visitor, so `null` is a valid answer and the caller decides.
2. **A session with no local user row is refused.** Accounts are created by an
   administrator, never auto-provisioned on first sign-in. Otherwise anyone who
   could present a token became a row in the register.
3. **`isActive` is checked here, not in a guard.** A deactivated officer may hold
   a perfectly valid unexpired session, so the account must be refused on every
   request — and the one place that cannot be forgotten is the place that builds
   the identity.

`getUser` revalidates against Supabase rather than trusting the cookie, so
deactivating an account takes effect immediately instead of at token expiry.

Three refusals are possible, and they are **deliberately distinguishable**,
because the fix for each is different: the account was never set up, the account
is deactivated (both need an administrator), or the platform cannot reach its
database (needs an operator). A broken platform must never present as "your
password was wrong".

### 2.4 Defence in depth around the database

Migration `drizzle/0001_supabase_auth.sql` enables **row level security on every
table with no policies**. That is intentional, not an oversight:

- The app connects as the table owner, which PostgreSQL exempts from row
  security, so every screen keeps working.
- Supabase's PostgREST is reachable with the public anon key. With RLS on and no
  policy, anything it can authenticate as is denied — so the register (teacher
  names, disciplinary records) is not readable through the public API.

The dependency this creates is stated in the migration and worth knowing: **the
role the app connects as must be the role that applied the migrations.** If it is
not, row security applies to the app and every screen silently returns nothing.

### 2.5 The lifecycle of a _write_

Writes do not go through a generic data layer. Each is an explicit, named
procedure in `server/routers.ts`, and each one repeats the same shape:

```
capability check  →  validate input  →  load the matter  →  business rules  →  write  →  audit entry
```

Two of those steps deserve attention:

- **Every mutation writes an audit row.** Who did what, to which matter, and when.
  This is the accountability trail, and it is why `openId` is retained even though
  it is no longer the identity join.
- **Server-side reads are never trusted.** The client sends a filter; the server
  counts. The province-wide figures above the register are counted by a separate
  query from the filtered page, so the numbers cannot drift from what is shown.

---

## 3. The five roles

`shared/roles.ts` gives the names; `shared/access.ts` gives the powers.

| Tier           | Title                                      | What they are for                            |
| -------------- | ------------------------------------------ | -------------------------------------------- |
| `staff`        | **Provincial Matters Officer**             | Runs the caseload day to day                 |
| `assistant`    | **Professional Assistant to the Director** | Runs the office around the caseload          |
| `commissioner` | **Director, Provincial Matters**           | Decides                                      |
| `admin`        | **Administrator**                          | Administrative oversight across the division |
| `super_admin`  | **Platform administrator**                 | Accounts, audit, system health               |

### The capability matrix

`●` = holds it, `—` = does not.

| Capability                                            | staff | assistant | commissioner | admin | super_admin |
| ----------------------------------------------------- | :---: | :-------: | :----------: | :---: | :---------: |
| `matter:register` — register a new matter             |   ●   |     ●     |      ●       |   ●   |      ●      |
| `matter:viewAll` — view the whole provincial register |   ●   |     ●     |      ●       |   ●   |      ●      |
| `matter:update` — update a matter                     |   ●   |     ●     |      ●       |   ●   |      ●      |
| `matter:escalate` — escalate a matter                 |   ●   |     ●     |      ●       |   ●   |      ●      |
| `matter:refer` — refer to a National Section          |   ●   |     —     |      ●       |   ●   |      ●      |
| `matter:decide` — record a decision                   |   —   |     —     |      ●       |   ●   |      ●      |
| `matter:flag` — flag for the Director's attention     |   —   |     ●     |      —       |   —   |      ●      |
| `referral:followUp` — record a section's response     |   ●   |     ●     |      —       |   —   |      ●      |
| `brief:write` — prepare a case brief                  |   ●   |     ●     |      ●       |   ●   |      ●      |
| `file:write` — add items to a case file               |   ●   |     ●     |      ●       |   ●   |      ●      |
| `report:view` — the Director's reporting set          |   —   |     ●     |      ●       |   ●   |      ●      |
| `platform:oversight` — oversight list & reassignment  |   —   |     —     |      —       |   ●   |      ●      |
| `platform:users` — manage accounts                    |   —   |     —     |      —       |   —   |      ●      |
| `platform:audit` — global audit trail                 |   —   |     —     |      —       |   —   |      ●      |
| `platform:stats` — system statistics                  |   —   |     —     |      —       |   —   |      ●      |

Three asymmetries are deliberate, and each traces to a section of the manual:

- **`assistant` cannot refer, and cannot decide.** §4 makes the judgement that a
  matter is outside provincial authority — and the §5 triggers that go with it —
  the Provincial Officer's act. §6 and §12C make the decision the Director's.
- **`assistant` and `commissioner` cannot flag.** The §12B flag is the
  Professional Assistant's instrument for escalating to the Director, so no other
  tier uses it.
- **`report:view` starts at `assistant`, not `commissioner`.** §12E has the
  Professional Assistant _preparing_ the weekly, monthly and quarterly reports;
  the Director receives them. The lowest tier that reaches a report is the one
  that makes it.

Navigation is gated by the same function (`DashboardLayout.tsx`), so a role never
sees a link it cannot use. And refusals are written in plain language — an officer
is told _"this action needs the Director"_, never a capability key.

---

## 4. How each role uses the site

### Every officer, on every role

**Sign in** at `/login` with the **email address and password** issued by the
platform administrator. Accounts are never self-created — public signup is
disabled, and an administrator vouches for each address at creation.

Signing in is only the first half. A correct password is not the same as being
let in, and the sign-in screen distinguishes three cases after Supabase accepts
you: your account was never set up, your account is deactivated, or the platform
is broken. Only the first two are about you.

_(`/guide` in the app is the short officer-facing version of this section. Note it
currently says "username" where the sign-in screen asks for an email address —
worth correcting.)_

**The Overview** (`/`) is the daily landing page: matters on the register, past
their due date, due within seven days, and not yet picked up.

**The Case register** (`/cases`) is the working list. It shows every matter in
the province — not a personal queue — and opens unfiltered, so nobody has to guess
which filter is hiding something. It is searchable by **case number or teacher's
name** (case-insensitive), and filterable by **status**, **matter type**,
**province**, and a **past due date only** toggle. Paged 25 rows at a time. The
figures across the top are counted by the server across the whole province,
separately from the filtered page below — so the headline number never silently
becomes "number of results".

**A matter** (`/cases/{id}`) has five tabs: **The matter** (fields, status,
section, deadlines), **Activity** (the full event history), **Referrals** (outbound
and responses), **File** (documents), and **Case brief**.

**Settings** (`/settings`) is your account, your avatar, and the appearance
preference. The theme is stored in _this browser only_, deliberately, so two
officers sharing a machine in a provincial office are not fighting over it.

### Provincial Matters Officer (`staff`) — the day-to-day worker

1. **Register** the matter (`/cases/new`): date received, province, teacher,
   employee reference if known, class, summary, and a **due date**. The due date
   is required — a matter with no deadline is invisible to the delay and overdue
   figures, which is the outcome the field exists to prevent.
2. **Work** it: update the status as it moves, set an assigned action, add items
   to the **File** as evidence arrives, and record the section it sits with.
3. **Refer** it when it exceeds provincial authority. This is their judgement and
   nobody else's.
4. **Follow up** the referral until an outcome is received, then record what came
   back.

### Professional Assistant (`staff` + monitoring) — the office around the caseload

The Assistant's distinctive surface is the **Case monitoring board**, seven lists
in the order the manual gives them, each carrying the matters in it rather than a
count — a number you cannot click into is no use at 8am:

1. New matters — registered, not yet picked up
2. Outstanding matters — held by the province
3. Delayed matters — past the due date
4. Matters with the Legal Section
5. Referred and awaiting a National Section
6. Flagged for the Director's attention (plus anything already at _Awaiting
   decision_, which is asking by its status whatever the flag says)
7. Case briefs still to prepare

Their other distinctive job is the **case brief** (§12B): preparing the short
report an officer presents to the Director. Six fields — issue, background, action
taken, current position, and — when the matter is flagged or already at _Awaiting
decision_ — **what is being decided** and **the recommendation**. Those last two
are mandatory in exactly that situation, enforced on the server: a brief that
reaches a decision without saying what the decision is about will be refused.

They also **produce the reporting set** (§12E), described in §6 below.

### Director (`commissioner`) — decides

Everything an officer can do, plus:

- **Record the decision**: outcome, decision date, and the decision maker's name.
  Gated on `matter:decide`, so an officer cannot record a decision.
- **Close the matter**, which requires all three parts of the Golden Rule's
  fourth limb (below) and is refused without them.
- **Read the reporting set** — though in practice the Assistant prepares it.

### Administrator (`admin`) — oversight across the division

Opens **Administration** and sees the **Oversight** tab: every matter in the
register regardless of assigned officer, with reassignment and status override.
Both write to the audit trail with a required reason.

### Platform administrator (`super_admin`) — the platform itself

Everything an Administrator can do, plus the **Users**, **Audit trail** and
**Statistics** tabs:

- **Users** — create an account (which also creates the Supabase identity),
  assign or change a role, deactivate, reset a username, delete. Two guards here
  are worth knowing because they explain _why_ the screen behaves as it does:
  deleting someone who appears in the accountability trail is refused, with the
  counts that block it and the advice to deactivate instead — deactivation closes
  the sign-in and keeps the record, which is what the audit trail needs. And the
  last active platform administrator cannot be deleted or demoted, because the
  platform has to remain manageable.
- **Audit trail** — every recorded action across the platform, searchable and
  filterable, filtered **in the database** so a search for an action from months
  ago finds it rather than paging through the newest events.
- **Statistics** — register totals, overdue rate, and a 12-month intake chart.

---

## 5. How a matter is handled

### 5.1 The eleven stages

`shared/statuses.ts` is the authority. These are the statuses and what they mean
in practice:

| Code  | Full label                        | Short label        | Where it sits                                   |
| ----- | --------------------------------- | ------------------ | ----------------------------------------------- |
| `NEW` | Newly received                    | New                | Just received. Nothing decided yet              |
| `VER` | Verification required             | Verification       | Checking the facts against the teacher's record |
| `INV` | Investigation in progress         | Investigation      | Enquiry under way                               |
| `REF` | Referred to National Section (HQ) | Referred           | With a National Section                         |
| `ADV` | Awaiting advice                   | Awaiting advice    | Advice requested, waiting on it                 |
| `DEC` | Awaiting decision                 | Awaiting decision  | The Director's decision is outstanding          |
| `LEG` | With Legal Section                | Legal              | With the province's legal advisers              |
| `ACT` | Action being implemented          | Action in progress | The decision is being carried out               |
| `ESC` | Escalated due to delay            | Escalated          | Escalated, most often for delay                 |
| `RES` | Resolved                          | Resolved           | Finished, outcome recorded                      |
| `CLS` | Closed                            | Closed             | Finished and formally closed                    |

Each status carries a full label and a short one, the short form being what appears
in dense tables and badges.

`RES` and `CLS` are the **closed** statuses (`CLOSED_STATUSES`); everything else
is open. That single constant is what makes "past their due date", "outstanding"
and "closure rate" mean the same thing everywhere.

### Escalation is a ladder, not a status

`ESCALATION_LEVELS` in `shared/delegation.ts` defines a seven-rung scale, from 0
to 6:

| Level | Meaning                                                                      |
| ----- | ---------------------------------------------------------------------------- |
| 0     | Officer — held by the responsible provincial matter officer                  |
| 1     | Senior / Regional officer — referred upward within the province              |
| 2     | Director, Provincial Matters — needs the Director's decision or intervention |
| 3     | Relevant National Section — referred out of the province for determination   |
| 4     | Commissioner / Management — needs management-level determination             |
| 5     | Commission — a matter for the Commission itself                              |
| 6     | Legal Section — where legal issues arise, in parallel with the above         |

This is a separate axis from the status. A matter can be at status `LEG` _and_ at
level 6; a matter escalated to the Director for a decision can sit at level 2 while
its status is still `VER`. Officers set the level through the escalation control,
and every change is recorded in the activity history with the level named.

A **referral** always lands at level 3 — or level 6 when it is to the Legal
Section, since that runs in parallel with the rest of the ladder rather than
instead of it.

### 5.2 The journey of a matter

The common path, and where each step is enforced:

```
Register                    NEW      §4   teacher, province, class, due date
  └─ pick up                VER      §4   assigned officer, action
       └─ investigate       INV      §4   notes into the File
            ├─ within provincial authority ──────────────┐
            │                                            │
            └─ beyond it → refer    REF   §4/§5        │
                    ├─ Legal Section  LEG    level 6    │
                    └─ any other section         level 3   │
                         └─ response arrives   §4   record it
                              └─ Director decides   DEC → §6
                                   └─ implement  ACT   §7
                                        └─ outcome recorded   RES  §17
                                             └─ closed    CLS  §17
```

The referral rows carry the escalation level the platform assigns them; see
"Escalation is a ladder" above for what the numbers mean.

A matter can also reach `ESC` (escalated) from delay rather than from a
referral — that is what `dashboard.monitoring.overdueOnFollowUp` counts.

### 5.3 The Golden Rule (§17)

The manual states one principle. The platform enforces it as **four hard
invariants on the server**, not as guidance in the UI — `shared/delegation.ts`,
`checkGoldenRule`:

| Part | Rule                                                | Enforced when                                                   |
| ---- | --------------------------------------------------- | --------------------------------------------------------------- |
| 1    | No teacher matter received without being registered | the form requires it at the point of receipt                    |
| 2    | No registered matter without an assigned action     | any status change that progresses the matter requires an action |
| 3    | No referred matter without follow-up                | a referral **cannot be created without a response deadline**    |
| 4    | No matter closed without a recorded outcome         | closure requires outcome + date + evidence of communication     |

Part 3 is the elegant one: rather than nagging about follow-up later, the platform
refuses to let a referral exist without a deadline attached. There is no state in
which a matter is referred and nobody is obliged to chase it.

Part 4 is enforced in two places, and both matter: the server refuses a status
change to `RES`/`CLS` without the three fields, and the **File** requires four
document classes before closure — _Original application/query_, _Decisions_,
_Evidence of communication to the teacher_, and _Closure record_. Seven further
classes are supported — supporting documents, correspondence in and out,
investigation notes, relevant records, referral letters and advice received — and
are optional.

### 5.4 Referrals (§4, §5)

A referral records: the National Section, the date, the escalation level, and —
always — the **response deadline**. A response is then recorded separately
(received date and the advice or outcome), and a referral is _pending_ until that
happens.

The National Sections are listed in `NATIONAL_SECTIONS` with the authority each
one holds, which is what makes routing a matter a judgement rather than a guess:

| Section                                | Primary authority                            |
| -------------------------------------- | -------------------------------------------- |
| Appointments                           | Appointment, selection and tenure            |
| Industrial and General                 | Salary, allowances and conditions of service |
| Legal Section                          | Legal interpretation and legal proceedings   |
| Relevant Policy / Management authority | Policy interpretation                        |
| Relevant records / HR functions (ICT)  | Teacher records and data                     |
| Provincial Matters                     | Provincial service delivery                  |

The class of matter also implies a **default** destination, so the common case
needs no thought — but the referral is always the officer's judgement to make,
which is why `matter:refer` sits with `staff` and not with `assistant`.

One conditional rule: an **Industrial and General** referral must state all four
required statements. It is checked on the server, and the dialog asks for them
only when the class calls for it.

### 5.5 The case file

Documents are typed rather than merely attached, because a file that cannot be
audited is not evidence. The four closure-critical classes above are what turn a
folder of attachments into a matter that can be closed.

### 5.6 Activity

Every matter carries an event history. Registration, each status change, each
referral and response, each document, each decision, and each closure are
recorded with the actor and the timestamp. This is what makes
`reports.goldenRule` and the audit trail possible.

---

## 6. The reporting set (§12E, §13, §18)

Gated on `report:view`, which starts at the Professional Assistant.

| Report                           | What it is                                                                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Weekly brief** (§13)           | The one-page Director's brief, sections A–F: new, outstanding, delayed, legal, awaiting response, and awaiting decision |
| **Monthly report** (§18.8)       | One month against the previous, with province, class and status breakdowns                                              |
| **Quarterly report** (§12E)      | One quarter against the previous, with intake, closures, closure rate, median days to close, and officer performance    |
| **Officer performance** (§18.9)  | Per-officer load, escalations, overdue count and closure rate                                                           |
| **Golden Rule compliance** (§17) | The register measured against all four limbs                                                                            |

Two deliberate choices worth knowing as a reader:

- **The monthly report's "by status" panel is register-wide, not month-scoped.** The
  screen labels it _"Every matter in the province, wherever it has reached"_
  because it answers a standing question, not a question about the month.
- **Officer performance counts the officer who originally registered the matter**,
  not whoever holds it now. Work that is handed over is still work that was done.

---

## 7. Where to look when you need to change something

| To change…                                   | Edit                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A status, a role, a province, a matter class | `shared/statuses.ts`, `shared/roles.ts`, `shared/matters.ts`                                     |
| Who can do what                              | `shared/access.ts` — the capability set, **and** the plain-language label in `CAPABILITY_LABELS` |
| A validation rule or refusal message         | `shared/validation.ts`                                                                           |
| The Golden Rule                              | `shared/delegation.ts` — `checkGoldenRule`                                                       |
| A workflow step                              | `server/db.ts` (`createReferral`, and the status handlers in `server/routers.ts`)                |
| A query or a figure                          | `server/db.ts` — this is where all counting happens                                              |
| A screen                                     | `client/src/views/`                                                                              |
| A new route or data fetch                    | `server/routers.ts` — every procedure states its capability, input and rule                      |

### Conventions this codebase holds to

- **Comments state intent and are expected to be true.** The highest-yield bug in
  this repository has been a comment describing correct behaviour next to code
  doing something subtly different. If you change a rule, update the comment; if
  the comment was right, the code was wrong.
- **A refusal is never a capability key.** It is a sentence an officer can act on.
- **Prefer a pure function in `shared/` over logic in a component.** If both sides
  need to agree, it belongs where they can both import it.
- **Never trust the client.** Recompute anything that decides on the server.
- **Refusals distinguish causes.** "Your account is deactivated" and "the database
  is unreachable" have opposite fixes; never collapse them into one message.

### Testing

`pnpm test` (Vitest), `pnpm check` (`tsc --noEmit`), `pnpm build`.

Coverage is deliberately uneven, and knowing where the gaps are matters:
`shared/` is heavily tested — pagination arithmetic, validation, the delegation
rules, capability guards, cache policy. The React layer is not: there is no
component test in the repository, because there is no DOM testing library
installed. Screen-level bugs are therefore found by reading, which is why the
comments matter so much. Two areas have been hardened recently with dedicated
tests: `server/screenContracts.test.ts` (what each screen asks for versus what the
routes accept) and `client/src/lib/dateInput.test.ts` (calendar dates versus
instants).

---

## 8. Glossary

| Term                 | Meaning                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| **Matter**           | A registered teacher complaint or query. The unit of work                         |
| **Caseload**         | All open matters in the province                                                  |
| **Register**         | The authoritative list of every matter. The system's source of truth              |
| **Section**          | The internal unit holding a matter — Provincial, Legal, Appointments, Secretariat |
| **National Section** | A national TSC unit a matter is referred out to                                   |
| **Referral**         | A matter sent to a National Section, with a response deadline                     |
| **Escalation level** | 6 Legal, 3 Appointments/Secretariat, 0 advisory                                   |
| **Case brief**       | The short report an officer prepares for the Director (§12B)                      |
| **Golden Rule**      | §17. Four invariants, enforced on the server                                      |
| **Oversight**        | The Administrator's province-wide list, with reassignment                         |
| **Audit trail**      | Every recorded action, with actor and timestamp                                   |
| **Capability**       | A named permission. Roles hold capabilities, not the reverse                      |
| **`authUserId`**     | The join from a local account to a Supabase identity                              |
