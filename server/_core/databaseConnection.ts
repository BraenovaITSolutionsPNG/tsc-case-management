/**
 * Turning DATABASE_URL into connection options that both the runtime and the
 * migration tooling accept.
 *
 * This exists because Supabase requires TLS, and a bare connection string
 * cannot carry a certificate authority — `postgresql://user:pass@host` has
 * nowhere to put a CA certificate. On top of that, Supabase assigns a port per
 * connection mode and the modes are not interchangeable: see `resolvePoolMode`.
 *
 * Both callers need the same answer, so it is computed once here:
 *
 *  - `server/db.ts`       — the request path, via node-postgres's `PoolConfig`
 *  - `drizzle.config.ts` — `pnpm db:push`, which needs a real session for DDL
 *
 * The credentials are read from the environment at call time rather than at
 * import time, so a test that moves DATABASE_URL between cases sees the change.
 */

import { readFileSync } from "node:fs";

/**
 * The credential fields, plus TLS. Deliberately a subset of node-postgres's
 * `PoolConfig` that drizzle-kit also accepts as `dbCredentials`, so the same
 * object is valid in both places.
 */
export type DatabaseCredentials = {
  host: string;
  port: number;
  user?: string;
  password?: string;
  database: string;
  /**
   * `false` rather than "absent" when TLS is not wanted, and the distinction is
   * not cosmetic. node-postgres reads a missing `ssl` as "decide from the
   * environment", which is usually right, but drizzle-kit fills the gap itself:
   * for credentials with no `ssl` key it passes `ssl: {}`, and an empty object
   * is truthy, so the driver opens a TLS connection to a server that has none
   * and fails with "The server does not support SSL connections". Saying `false`
   * explicitly is the only way to tell drizzle-kit that plain TCP is intended.
   */
  ssl: { ca?: string; rejectUnauthorized: boolean } | false;
};

const PEM_HEADER = "-----BEGIN CERTIFICATE";

/**
 * The certificate authority that signed the database server's certificate, if
 * one was supplied.
 *
 * `DATABASE_CA_CERT` takes either form deliberately. A hosted deployment has no
 * dependable filesystem — a file path resolved on a serverless function is not a
 * thing that exists — so the PEM itself is pasted into the environment. A
 * developer connecting from a laptop would rather point at the `ca.crt` that
 * Supabase's dashboard offers than paste a certificate into `.env`, and a pasted
 * PEM is unmistakable: it announces itself with the BEGIN line, where a path
 * never would. The CA is public by nature, so it is not a secret either way and
 * needs no special care in git.
 */
function readCaCertificate(): string | undefined {
  const value = process.env.DATABASE_CA_CERT?.trim();
  if (!value) return undefined;
  if (value.includes(PEM_HEADER)) return value;
  try {
    return readFileSync(value, "utf8");
  } catch (cause) {
    throw new Error(
      `DATABASE_CA_CERT names a file that cannot be read (${value}). Paste the PEM itself if there is no file to read — Supabase offers it under Connection settings.`,
      { cause }
    );
  }
}

/**
 * TLS, decided once.
 *
 * Supabase refuses a connection that does not offer TLS, so a hosted deployment
 * has to end up here. The three outcomes, in the order they are decided:
 *
 *  1. `DATABASE_CA_CERT` set — TLS, and the server's certificate is verified
 *     against that CA. This is the Supabase case, and the only one that
 *     verifies a certificate this deployment chose to trust.
 *  2. `DATABASE_SSL=require` with no CA — TLS, verified against the host's
 *     trust store. Supabase's certificates chain to a public CA, so this is
 *     correct for them and needs no downloaded file.
 *  3. Neither — no TLS, returned as an explicit `false` rather than an absent
 *     key. See the note on `DatabaseCredentials["ssl"]` for why that spelling
 *     matters to drizzle-kit. This is what a local PostgreSQL speaks, and why
 *     nothing here is unconditional: switching the app to a hosted database must
 *     not break the machine it was developed on.
 *
 * `rejectUnauthorized` is never set false. A hosted database reached over an
 * unverified connection is a case-management register — teacher names, matter
 * files, disciplinary records — on a wire anyone on the path can read and
 * rewrite, and an attacker who can redirect the connection gets to serve the
 * answers. Turning verification off is not offered as an option here; if the
 * certificate genuinely cannot be verified, the CA is the fix.
 */
function resolveSsl(): DatabaseCredentials["ssl"] {
  const ca = readCaCertificate();
  if (ca) return { ca, rejectUnauthorized: true };

  const requested = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (requested === "require" || requested === "true") {
    return { rejectUnauthorized: true };
  }
  if (requested === "disable" || requested === "false") {
    return false;
  }
  return false;
}

/**
 * One sentence about how this connection is secured, logged once at startup
 * alongside the server version.
 *
 * It exists because "TLS off" is otherwise indistinguishable from "TLS
 * requested and silently dropped", and a deployment that believes it is
 * encrypted when it is not is worse than one that never asked.
 */
export function describeTls(): string {
  const ca = readCaCertificate();
  if (ca) return "TLS on, verified against the CA in DATABASE_CA_CERT";
  const requested = process.env.DATABASE_SSL?.trim().toLowerCase();
  if (requested === "require" || requested === "true") {
    return "TLS on, verified against the host trust store";
  }
  return "TLS OFF";
}

/**
 * Supabase's port says how the connection is pooled, and the three modes are
 * not interchangeable. Picking the wrong one is the most common way a Supabase
 * deployment breaks in a way that looks like an application bug.
 *
 *  - 5432 direct. No pooling in front of it, so every connection is a real
 *    backend. Correct for migrations, and for a single long-lived process.
 *  - 6543 transaction mode (PgBouncer). The pooler hands a connection back after
 *    each transaction, so the connection count stays flat under load. It cannot
 *    hold session state: no `SET`, no advisory locks, no multi-statement
 *    transactions. Fine for this app's queries, which are each one statement.
 *  - 6544 session mode. The pooler keeps the backend for the life of the client
 *    session. Needed for DDL, which is why migrations must not use this port
 *    together with a pooler that discards sessions mid-statement.
 *
 * The port is taken from the URL when it carries one, because Supabase hands out
 * all three and the developer chose between them. 6543 is the default here
 * because it is the pooler Supabase's own dashboard suggests for a deployed
 * application, and it is the only one of the three that survives a serverless
 * function creating a pool per invocation.
 */
function resolvePort(url: URL): number {
  if (url.port) return Number(url.port);
  if (process.env.DATABASE_POOL_MODE?.trim().toLowerCase() === "session") {
    return 6544;
  }
  return 5432;
}

/**
 * The credentials in DATABASE_URL, with TLS attached.
 *
 * Percent-decoding is done per field rather than by handing the URL straight to
 * the driver, because the driver is only reached through a config object once
 * the CA has to be added: `drizzle(config)` and drizzle-kit's
 * `{ host, ... }` credential form both need the fields, not a string.
 *
 * Throws on a URL that is absent or unparseable rather than returning a partial
 * answer. A connection to `localhost` with no password would connect to
 * something, and the failure would then read as a missing table.
 */
export function databaseCredentials(): DatabaseCredentials {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set. Point it at the database the deployment uses."
    );
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch (cause) {
    throw new Error(
      "DATABASE_URL is not a URL this can read. It is written postgresql://user:password@host:port/database — Supabase puts its own port, and a URL without one means the direct connection on 5432.",
      { cause }
    );
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error(
      `DATABASE_URL is a ${url.protocol}// URL, and this platform speaks the PostgreSQL protocol only.`
    );
  }

  const ssl = resolveSsl();
  return {
    host: decodeURIComponent(url.hostname),
    port: resolvePort(url),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ssl,
  };
}
