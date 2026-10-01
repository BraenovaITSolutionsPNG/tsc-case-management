# TSC Case Management

A case management platform for the Kenya Teachers Service Commission's Provincial
Matters office, implementing the TSC Provincial Matters Administration Manual.

It registers and tracks teacher matters through the manual's 11-stage workflow,
refers them to National TSC sections, escalates them as deadlines pass, and
produces the weekly, monthly and quarterly returns the Commission requires.

React 19 + Next.js 16 (App Router) + Tailwind/shadcn UI, tRPC over Next.js route
handlers, Drizzle ORM on PostgreSQL (Supabase), Supabase Auth, S3 file storage.

---

## Quick start

```bash
pnpm install
cp .env.example .env          # then fill in the values below
pnpm db:push                  # create the schema
pnpm db:seed                  # create the first administrator
pnpm dev
```

Two commands need a database you can reach and a Supabase project you hold keys
for. Everything else is local.

### What you need from Supabase

Project Settings → API:

| Value              | Where it goes                                           | Secret?                     |
| ------------------ | ------------------------------------------------------- | --------------------------- |
| Project URL        | `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`           | No — it is in every browser |
| `anon` public key  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_ANON_KEY` | No — it is in every browser |
| `service_role` key | `SUPABASE_SERVICE_ROLE_KEY`                             | **Yes**                     |

Connection settings → URI, for `DATABASE_URL` and the two GitHub secrets below.

> The `service_role` key bypasses row level security entirely. It must never be
> given a `NEXT_PUBLIC_` prefix — that inlines it into the browser bundle, which
> anyone can download. It is used for exactly three things, all administrator
> actions: creating an account, generating a password-reset link, and setting a
> password directly.

---

## Commands

| Command            | What it does                                         |
| ------------------ | ---------------------------------------------------- |
| `pnpm dev`         | Development server on port 3000                      |
| `pnpm build`       | Production build                                     |
| `pnpm start`       | Serve the production build                           |
| `pnpm check`       | TypeScript, no emit                                  |
| `pnpm test`        | Vitest                                               |
| `pnpm format`      | Prettier                                             |
| `pnpm db:push`     | Generate a migration from the schema, then apply it  |
| `pnpm db:migrate`  | Apply migrations only (no generation)                |
| `pnpm db:seed`     | Create the first administrator                       |
| `pnpm db:verify`   | Assert the schema landed and is safe                 |
| `pnpm db:testdata` | Load the demonstration register                      |
| `pnpm db:load`     | Import the pre-PostgreSQL MySQL data (one time only) |

---

## The database

### Two connection strings, and they are not interchangeable

Supabase issues several per project, and picking the wrong one is the most
common way a Supabase deployment breaks in a way that looks like an application
bug.

| Port | Mode        | Used for                   | Why                                                      |
| ---- | ----------- | -------------------------- | -------------------------------------------------------- |
| 5432 | direct      | **migrations and imports** | DDL runs in a transaction; it needs a session that lasts |
| 6543 | transaction | the running application    | Holds the connection count flat under serverless load    |
| 6544 | session     | rarely needed              | Holds a session if something requires one                |

So: **run the app against 6543, run migrations against 5432.** Sending DDL
through the transaction pooler fails partway through, because the pooler hands
the backend back between transactions.

### Applying migrations

**In production**, push to `main`. `.github/workflows/db-push.yml` applies
`drizzle/` to the deployed database and then runs `pnpm db:verify`. It uses
`drizzle-kit migrate`, never `generate` — a migration generated on a runner and
never committed is a migration nobody reviewed.

It needs two repository secrets:

```bash
gh secret set DATABASE_URL -R <owner>/<repo>
gh secret set DATABASE_CA_CERT -R <owner>/<repo>
```

- `DATABASE_URL` — the **session pooler** string
  (`aws-0-<region>.pooler.supabase.com:5432`). Not the direct host: it publishes
  only an AAAA record and a hosted runner has no IPv6 route, so the connection
  dies with `ENETUNREACH` before a statement runs. Not the transaction pooler,
  for the reason above.
- `DATABASE_CA_CERT` — the server root certificate from Dashboard → Database →
  SSL Configuration, labelled `prod-ca-2021.crt` and downloaded from that page.
  Supabase's own CA, not a public one, so the runner's trust store cannot verify
  the pooler's certificate and the connection fails with
  `SELF_SIGNED_CERT_IN_CHAIN`. A CA certificate is public, so storing it as a
  secret is harmless; the workflow refuses to run without it, because a missing
  secret and a wrong one look identical in the log.

**Locally**, only if your network can reach Postgres:

```bash
DATABASE_URL=<the 5432 string> pnpm db:push
```

If it fails with `Network is unreachable` while HTTPS to supabase.com works, that
is an egress firewall on outbound Postgres ports, not a bad credential. Use the
workflow, or the local database below.

### Applying the schema without a connection (Supabase SQL Editor)

If neither route is available — no CA certificate to hand, a network that blocks
Postgres, or a machine with no IPv6 route to the direct host — the dashboard's SQL
Editor needs no connection string, no certificate and no secret:

```bash
pnpm db:sql                     # writes database/schema-apply.sql
open database/schema-apply.sql  # select all, paste into SQL Editor -> Run
```

It concatenates `drizzle/*.sql` in journal order, with the same verification
queries `db:verify` makes appended at the end. Read the output: five tables, all
`rls_enabled = t`, `policies_should_be_zero = 0`, `has_authuserid = t`,
`has_passwordhash_must_be_false = f`.

This is the fallback rather than the preferred route, and the difference is worth
stating. The SQL Editor applies DDL as whoever is signed into the dashboard and
records nothing, so a database built this way has no rows in
`drizzle.__drizzle_migrations` and `drizzle-kit migrate` will later try to
re-apply everything from `0000`. Every statement is either guarded or fails on
"already exists", so that is noisy rather than harmful — but the CI route is
preferred wherever it works, because it leaves a record of what it applied.

### A local database, for working offline

```bash
docker compose up -d
```

Then point `DATABASE_URL` at it and set `DATABASE_SSL=disable`:

```
DATABASE_URL=postgresql://tsc:tsc_dev_password@127.0.0.1:5433/tsc_case_management
```

5433 rather than 5432 so it does not collide with another project's database.
`docker compose down -v` deletes the data.

### What `pnpm db:verify` asserts

Not just that the tables exist. It fails the deploy when:

- `users` or `cases` is missing — the schema was never applied here
- `users.passwordHash` still exists — a migration predating the move to Supabase
  was applied to a database that has moved on, and a copy of every officer's old
  password is sitting in a readable table
- `users.authUserId` is missing — no account can be linked to a Supabase identity,
  so every officer is refused at the front door
- row level security is **off** on any table

That last one matters more than it looks. The anon key is a public value that is
in every browser by design; with RLS off, it is a way to read the entire case
register without signing in at all. Migration `0001_supabase_auth.sql` turns RLS
on for every table and deliberately creates **no policies** — every read goes
through the server as the table owner, and every role PostgREST can authenticate
as is denied.

> RLS exempts the table owner, which is what lets the application keep working.
> The role the app connects as must therefore be the role that applied the
> migrations. If that ever diverges, every screen returns nothing.

---

## Accounts and sign-in

Supabase owns credentials and sessions. This deployment holds no signing key of
its own: it does not mint, verify or refresh a JWT, and there is no
`JWT_SECRET`. Sign-in happens against Supabase from the browser; the httpOnly
session cookie it writes is what the server reads back on each request.

`users.authUserId` is the join to `auth.users`, and it is the only thing the
request path looks an officer up by. A null is never a sign-inable state — it is
an account that cannot sign in until an administrator provisions it, which the
admin screen reports as unprovisioned rather than as broken. `openId` is kept
because the audit log and the case register reference officers by it.

**There is no public signup.** Supabase's own email signup is left switched off,
and a valid Supabase session with no matching row is refused rather than
auto-provisioned — because otherwise anyone who found the URL became a row in the
register. Accounts are created by an administrator, which is what makes the
register's contents attributable.

### The first account

An empty database has nobody in it, and nothing in the application can create the
first user: the admin screen that creates accounts is behind a capability only an
administrator already holds. So it is made from outside, once:

```bash
DATABASE_URL=... \
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
SEED_ADMIN_EMAIL=you@example.org \
pnpm db:seed
```

It creates one `super_admin`. Re-running it changes nothing unless
`SEED_ADMIN_PASSWORD` is offered again, which is how a lost password is replaced.
`SEED_ADMIN_EMAIL` must be an address that can receive a password reset: it is
where Supabase sends one, and in production the seed refuses to run at the
`example.com` default rather than create the one account that cannot be recovered.

### Adding the other officers

From the admin screen, signed in as the administrator. That path creates the
Supabase identity first and the register row second, and removes the identity
again if the row fails — so a failed creation never leaves an account occupying
the address that cannot sign in.

Passwords are optional. Left out, the officer sets their own via a reset link,
which means no administrator ever handles somebody else's credential. Where SMTP
is not configured, an administrator can set a password directly; that is a
deliberate fallback rather than a convenience, because an officer locked out of a
disciplinary register is a problem that waits for no one.

> **This is what needs `SUPABASE_SERVICE_ROLE_KEY` on the deployment.** Creating an
> account, issuing a reset link and setting a password directly all go through
> Supabase's admin API, and no client can reach it without the service role. It
> bypasses row level security, so it is a genuine privilege: set it in Vercel as a
> **Sensitive** variable, and never give it a `NEXT_PUBLIC_` prefix. Every
> operation that uses it is an administrator action, gated on `platform:users`.

## Demonstration data

```bash
DATABASE_URL=<the 5432 string> pnpm db:testdata
```

Eleven invented matters, one per status value, so the dashboard figures, the
weekly brief and the monthly and quarterly reports all have something to count.
Plus officers across the tiers, a worked event timeline, both kinds of referral,
and case-file entries.

Additive and idempotent — re-running adds nothing. It is a reviewable SQL file
(`database/test-data.sql`) rather than a script because a hundred rows of inserts
that a person has never seen land in a register of disciplinary matters is not
something to execute on trust. It invents every name in it, and it creates no
Supabase identities: those are for the admin screen.

Run `pnpm db:seed` first — a matter needs an accountable officer, and the file
refuses to write a register whose every row is unattributable.

---

## Deployment

### Vercel

Set these as project environment variables:

| Variable                          | Notes                                                     |
| --------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL`                    | Session pooler, port 6543                                 |
| `DATABASE_SSL`                    | `require`                                                 |
| `NEXT_PUBLIC_SUPABASE_URL`        | **Build time** — inlined into the bundle                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`   | **Build time** — inlined into the bundle                  |
| `SUPABASE_URL`                    | Runtime                                                   |
| `SUPABASE_ANON_KEY`               | Runtime                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`       | Runtime, never public. **Required** — it creates accounts |
| `BUILT_IN_FORGE_API_URL` / `_KEY` | Required in production; uploads fail loudly without them  |
| `NEXT_PUBLIC_APP_ID`              | Any string identifying the deployment                     |

Leave Supabase's own email signup **switched off** (Authentication → Sign In /
Providers → Email). The platform has no public sign-up: a Supabase identity with
no register row is refused, so an account exists only once an administrator
creates it. That is what keeps the register's contents attributable — and it is
why the service role is needed on the deployment, since every account is created
through Supabase's admin API.

The two `NEXT_PUBLIC_` pairs and their `SUPABASE_` counterparts must name the
**same** Supabase project. If the browser was built for one project and the
server reads another, sign-in fails with "invalid login credentials" for a
password that is correct — and nothing in the symptom points at the build. The
server checks for that disagreement at startup and refuses to serve rather than
let it out.

If your host cannot separate build-time from run-time environment, setting only
the `NEXT_PUBLIC_` pair is enough; the server falls back to it.

> **`/login` is statically prerendered.** The sign-in page is baked at build time
> with the Supabase values inlined, and it reports "not configured" as a
> build-time fact. Adding `NEXT_PUBLIC_SUPABASE_*` to the environment
> _after_ a build changes nothing until the next deploy — the page that decides
> whether a sign-in form exists was compiled without it. If sign-in is
> unavailable in production, redeploy rather than restarting.

The service role key never reaches the browser bundle: only the project URL and
the anon key are inlined into `.next/static`, which is the whole reason it has no
`NEXT_PUBLIC_` prefix. Worth knowing what to check if that ever changes —
`grep -r <service-role-key> .next/` should find nothing.

`.vercelignore` is read **instead of** `.gitignore`, so it restates every
exclusion that matters. `.env` and the MySQL data dumps are named there
explicitly: the dumps hold 781 accounts with password hashes, teacher names and
the text of disciplinary matters, and would otherwise be uploaded on every deploy.

---

## Layout

```
app/                  Next.js routes, layouts, and the tRPC handler
client/src/views/     The screens
client/src/lib/       Browser Supabase client, tRPC and query clients
server/               tRPC routers, db access, and the auth modules
server/_core/         Env, database connection, Supabase clients, providers
server/auth/          Administrator-side account operations
shared/               Rules shared by server and client — the source of truth
drizzle/              Schema, generated migrations, and their snapshots
database/             Bootstrap, test data, and the MySQL import path
scripts/              Schema verification, MySQL→PostgreSQL conversion
```

`shared/` holds the TSC rules as data and functions — roles, capabilities,
statuses, the 11-stage workflow, the §12C brief headings, the closure checklist —
and both ends import them. That is why a rule change does not need making twice,
and why the manual's requirements are testable without a database.

Tests cover the manual's rules (case management, delegation, closure, quarterly
returns, §12C), authorization on every admin section, sign-out, the Supabase
configuration guards, pagination arithmetic, and the query cache policy.

---

## Troubleshooting

**"Network is unreachable" connecting to Supabase, while HTTPS works.**
An egress firewall on outbound Postgres ports. Migrations go through the GitHub
workflow; the app needs the pooler reachable, so use `docker compose up -d`.

**`SELF_SIGNED_CERT_IN_CHAIN` in the migration job.**
`DATABASE_CA_CERT` is unset or wrong. It must be the PEM from Dashboard →
Database → SSL Configuration (the server root certificate, `prod-ca-2021.crt`).

**Sign-in works, then every officer is refused.**
The session resolved no `users` row: either `authUserId` is null (unprovisioned —
the admin screen will say so) or the browser and server are pointed at different
Supabase projects (the server refuses to start on that, so check the log first).

**`no schema changes, nothing to migrate` but the database looks wrong.**
`pnpm db:verify` reports what it actually found, including which columns are
missing. Read it before re-running anything.

**Every screen is empty but the database has rows.**
The application is not connecting as the table owner, so row level security
applies to it. Check which role `DATABASE_URL` uses against who owns the tables.
