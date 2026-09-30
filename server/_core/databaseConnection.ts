/**
 * Turning DATABASE_URL into connection options that both the runtime and the
 * migration tooling accept.
 *
 * This exists because the provider requires TLS and a certificate authority of its
 * own, and a bare connection string cannot carry either. `mysql://user:pass@host`
 * has nowhere to put a CA certificate, so pointing the app at the provider used to mean
 * a `ssl` block that neither `drizzle(url)` nor drizzle-kit's `{ url }` form
 * would read — and the symptom is a connection refused with nothing in the
 * message saying why.
 *
 * Both callers need the same answer and used to compute it differently (in
 * fact, neither did), so it is computed once here:
 *
 *  - `server/db.ts`            — the request path, via drizzle-orm's `PoolOptions`
 *  - `drizzle.config.ts`      — `pnpm db:push`, which needs a session-level
 *                               connection for DDL
 *
 * The credentials are read from the environment at call time rather than at
 * import time, so a test that moves DATABASE_URL between cases sees the change.
 */

import { readFileSync } from "node:fs";

/**
 * The credential fields, plus TLS. Deliberately a subset of mysql2's
 * `ConnectionOptions` that drizzle-kit also accepts as `dbCredentials`, so the
 * same object is valid in both places.
 */
export type DatabaseCredentials = {
  host: string;
  port: number;
  user?: string;
  password?: string;
  database: string;
  ssl?: { ca?: string; rejectUnauthorized: boolean };
};

const PEM_HEADER = "-----BEGIN CERTIFICATE";

/**
 * The certificate authority that signed the database server's certificate, if
 * one was supplied.
 *
 * `DATABASE_CA_CERT` takes either form deliberately. A hosted deployment has no
 * dependable filesystem — a file path resolved on a Vercel function is not a
 * thing that exists — so the PEM itself is pasted into the environment. A
 * developer running the provider service locally would rather point at the
 * `ca.crt` the console downloaded than paste a certificate into `.env`, and a
 * pasted PEM is unmistakable: it announces itself with the BEGIN line, where a
 * path never would. The CA is public by nature, so it is not a secret either
 * way and needs no special care in git.
 */
function readCaCertificate(): string | undefined {
  const value = process.env.DATABASE_CA_CERT?.trim();
  if (!value) return undefined;
  if (value.includes(PEM_HEADER)) return value;
  try {
    return readFileSync(value, "utf8");
  } catch (cause) {
    throw new Error(
      `DATABASE_CA_CERT names a file that cannot be read (${value}). Paste the PEM itself if there is no file to read — the provider's dashboard offers it under Connection information.`,
      { cause }
    );
  }
}

/**
 * TLS, decided once.
 *
 * the provider terminates TLS and will refuse anything that does not offer it, so a
 * hosted deployment has to end up here. The three outcomes, in the order they
 * are decided:
 *
 *  1. `DATABASE_CA_CERT` set — TLS, and the server's certificate is verified
 *     against that CA. This is the provider case, and the only one that verifies
 *     a certificate this deployment chose to trust.
 *  2. `DATABASE_SSL=require` with no CA — TLS, verified against the host's
 *     trust store. For a service whose certificate chains to a public CA,
 *     which needs no downloaded file.
 *  3. Neither — no TLS. Which is what the local MariaDB in docker-compose.yml
 *     speaks, and why nothing here is unconditional: switching the app to a
 *     hosted database must not break the machine it was developed on.
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
  return undefined;
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
 * The credentials in DATABASE_URL, with TLS attached.
 *
 * Percent-decoding is done per field rather than by handing the URL straight to
 * the driver, because the driver is only reached through a config object once
 * the CA has to be added: `drizzle({ connection })` and drizzle-kit's
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
      "DATABASE_URL is not a URL this can read. It is written mysql://user:password@host:port/database — the provider puts its own port, and a URL without one defaults to 3306.",
      { cause }
    );
  }

  if (url.protocol !== "mysql:" && url.protocol !== "mysqlx:") {
    throw new Error(
      `DATABASE_URL is a ${url.protocol}// URL, and this platform speaks the MySQL wire protocol only. the provider for PostgreSQL would need the schema and every query in server/db.ts ported first.`
    );
  }

  const ssl = resolveSsl();
  return {
    host: decodeURIComponent(url.hostname),
    // the provider does not listen on 3306: the port is assigned per service and
    // changes if the service is rebuilt, so it belongs in the URL rather than
    // defaulted here.
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    ...(ssl ? { ssl } : {}),
  };
}
