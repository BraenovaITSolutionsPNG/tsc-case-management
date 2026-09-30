import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Local username-and-password credentials.
 *
 * This exists so the platform can be signed into and demonstrated without a
 * live TSC identity provider. It is NOT the production authentication path -
 * `ENV.isProduction` refuses every route in this module, and the OAuth flow
 * remains the only way in for a deployed instance.
 *
 * Hashing is scrypt from Node's own crypto, deliberately not bcrypt or argon2:
 * it is a memory-hard KDF designed for exactly this, it needs no new dependency
 * in a government system, and there is no third-party code in the credential
 * path. Parameters below are the current OWASP guidance for scrypt.
 */

const KEY_LENGTH = 64;
const SCRYPT_PARAMS = {
  // N = 2^15, r = 8, p = 1: ~32 MB and ~100ms per verification on modest
  // hardware. Slow enough to make offline cracking expensive, fast enough that
  // an officer signing in does not notice.
  N: 32768,
  r: 8,
  p: 1,
} as const;

/**
 * scrypt allocates roughly 128 * N * r bytes, which for the parameters above is
 * 32 MB - exactly Node's default maxmem, so the default rejects them. It has to
 * be raised explicitly, with headroom, or every hash and every verification
 * throws ERR_CRYPTO_INVALID_SCRYPT_PARAMS.
 */
const MAX_MEM = 128 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r * 2;

/**
 * Stored as `scrypt$N$r$p$salt$key`, all base64. The parameters travel with the
 * hash so they can be raised later without invalidating existing passwords.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...SCRYPT_PARAMS,
    maxmem: MAX_MEM,
  });
  return [
    "scrypt",
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

/**
 * Constant-time verification. Returns false rather than throwing on a
 * malformed or absent hash, so a corrupt row reads as "wrong password" and
 * never reveals that the stored value was unusual.
 */
export function verifyPassword(
  password: string,
  stored: string | null | undefined
): boolean {
  if (!stored) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (
    !Number.isSafeInteger(N) ||
    !Number.isSafeInteger(r) ||
    !Number.isSafeInteger(p)
  ) {
    return false;
  }
  // Refuse absurd parameters from a tampered row rather than allocating
  // gigabytes: cap N at the value we would set today.
  if (N > SCRYPT_PARAMS.N || r > SCRYPT_PARAMS.r || p > SCRYPT_PARAMS.p)
    return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;

  // Bounded by the same ceiling as hashing, so a tampered row cannot make the
  // server allocate an arbitrary amount of memory.
  const maxmem = Math.min(128 * N * r * 2, MAX_MEM);
  const actual = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N,
    r,
    p,
    maxmem,
  });
  return timingSafeEqual(actual, expected);
}

/**
 * Password policy for a local credential. Deliberately modest: length over
 * symbol soup, because this is a demonstration path and a policy that fights
 * the user produces passwords written on a sticky note.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 10) {
    return "Use at least 10 characters.";
  }
  if (!/[a-z]/i.test(password) || !/\d/.test(password)) {
    return "Include at least one letter and one number.";
  }
  return null;
}

/** Normalises a typed username so "Ruth " and "ruth" are the same account. */
export function normaliseUsername(value: string): string {
  return value.trim().toLowerCase();
}
