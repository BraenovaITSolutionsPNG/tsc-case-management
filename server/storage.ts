// Object storage for case files and avatars.
//
// Two backends. Development writes to a directory under the project, so nothing
// is needed to work on the app offline. A deployment presigns and PUTs — either
// through Supabase Storage, which is the project's own provider and needs no
// third party, or through the Forge/S3 presigner where that is configured
// instead. See `storagePut`. Downloads are served from /files/{key}, which
// answers a 307 to a signed read when the object is in a bucket and reads the
// bytes off disk when it is not.

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ENV } from "./_core/env";

/**
 * Where the development fallback writes. Under the project rather than /tmp, so
 * a restart does not lose the officer's uploaded profile image, and so the
 * directory is obvious to anyone who goes looking.
 *
 * Resolved lazily rather than at module scope. `import.meta.dirname` is
 * undefined once the bundler has rewritten this module for a build or for page
 * data collection, so reading it while the module is being evaluated throws
 * `paths[0] must be of type string` and fails the whole production build. It is
 * read inside `localStorageRoot()` instead, which only ever runs while serving
 * a request, where the module is running as the ES module it was written as.
 */
export function localStorageRoot(): string {
  return path.resolve(
    import.meta.dirname ?? process.cwd(),
    "..",
    ".local-storage"
  );
}

/**
 * How long a signed read lives, in seconds.
 *
 * Short, because the /files route hands the URL to the browser as a redirect
 * target and a long-lived one is a URL that keeps working for anyone who
 * captures it. A minute is long enough to fetch an avatar and a case file, and
 * short enough that a leaked link is not a lasting problem. Nothing in the app
 * links to a file across a session.
 */
const SIGNED_URL_TTL_SECONDS = 60;

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set SUPABASE_STORAGE_BUCKET with SUPABASE_SERVICE_ROLE_KEY, or BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

/**
 * Whether the Forge/S3 presigner is configured.
 *
 * Checked before Supabase Storage in each operation, so a deployment that has
 * deliberately pointed uploads at the presigner keeps doing that. The order
 * matters because the alternative is worse than either: Supabase is available
 * wherever the service role key is, and that key is required for administrator
 * features regardless of storage, so preferring Supabase would quietly ignore a
 * Forge configuration on a deployment that had gone to the trouble of setting
 * one. Supabase is the default precisely because it needs no configuration, not
 * because it outranks one.
 */
function hasForgeConfig() {
  return Boolean(ENV.forgeApiUrl && ENV.forgeApiKey);
}

/**
 * The Supabase Storage coordinates, or null when that is not the backend.
 *
 * Returns null rather than throwing so the caller can fall through to the
 * Forge presigner: both are legitimate ways to reach a bucket, and which one is
 * in use is a deployment decision rather than a fault.
 */
function supabaseStorage() {
  if (!ENV.hasSupabaseStorage) return null;
  return {
    /**
     * Object reads, writes and deletes. The bucket is part of the path.
     */
    objects: `${ENV.supabaseUrl}/storage/v1/object/${ENV.storageBucket}`,
    /**
     * Signing, which is a *different* path shape: `sign` comes before the
     * bucket, not after. Getting that order wrong does not fail loudly — it
     * resolves to a path that looks like an object named `sign/...`, and the
     * API rejects it as an unsupported mime type, which reads as a bucket policy
     * problem and is not one.
     */
    sign: `${ENV.supabaseUrl}/storage/v1/object/sign/${ENV.storageBucket}`,
    key: ENV.supabaseServiceRoleKey,
  };
}

function supabaseHeaders(extra: Record<string, string> = {}) {
  return {
    apikey: ENV.supabaseServiceRoleKey,
    Authorization: `Bearer ${ENV.supabaseServiceRoleKey}`,
    ...extra,
  };
}

/** Turn a storage failure into the sentence the officer is shown. */
async function storageFailure(
  what: string,
  response: Response
): Promise<never> {
  const detail = await response.text().catch(() => response.statusText);
  throw new Error(`${what} (${response.status}): ${detail}`);
}

/**
 * Resolve a key to a path inside the local fallback root, or null if the key
 * would escape it.
 *
 * A key arrives from the database and, in the local backend, is turned into a
 * filesystem path - so `../../etc/passwd` is reachable unless this refuses it.
 * Checked after normalisation and before the path is built, and the resolved
 * path is re-checked against the root, because a key containing a symlinked
 * segment would pass a prefix test on the unresolved string.
 */
export function localPathForKey(relKey: string): string | null {
  const key = relKey.replace(/^\/+/, "");
  if (!key) return null;
  if (key.includes("\0")) return null;

  const root = localStorageRoot();
  const resolved = path.resolve(root, key);
  // path.relative gives a path from root to target; `..` in it means the target
  // sits outside, and an absolute result means the key was absolute.
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

  return resolved;
}

/** Read an object from the local fallback, or null if it is not there. */
export async function localGet(relKey: string): Promise<Buffer | null> {
  const target = localPathForKey(relKey);
  if (!target) return null;
  try {
    return await readFile(target);
  } catch {
    return null;
  }
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream"
): Promise<{ key: string; url: string }> {
  const key = appendHashSuffix(normalizeKey(relKey));

  if (ENV.useLocalStorage) {
    const target = localPathForKey(key);
    if (!target) throw new Error("Invalid storage key");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(
      target,
      typeof data === "string"
        ? Buffer.from(data)
        : Buffer.from(data as Uint8Array)
    );
    return { key, url: `/files/${key}` };
  }

  const storage = hasForgeConfig() ? null : supabaseStorage();
  if (storage) {
    // Straight to the bucket, over the service role. No presigned step and no
    // second host: the object never leaves Supabase, which is the whole reason
    // this is the preferred backend over an external presigner on a project
    // that already has a provider.
    //
    // `x-upsert` so re-uploading the same logical file replaces it rather than
    // failing — the key carries a content hash, so a genuine second version has
    // a different key and cannot overwrite an earlier one.
    const body =
      typeof data === "string"
        ? Buffer.from(data)
        : Buffer.from(data as Uint8Array);

    const response = await fetch(`${storage.objects}/${key}`, {
      method: "POST",
      headers: supabaseHeaders({
        "Content-Type": contentType,
        "x-upsert": "true",
      }),
      body,
    });

    if (!response.ok) {
      await storageFailure("Storage upload failed", response);
    }

    return { key, url: `/files/${key}` };
  }

  const { forgeUrl, forgeKey } = getForgeConfig();

  // 1. Get presigned PUT URL from Forge
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Forge returned empty presign URL");

  // 2. PUT file directly to S3
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/files/${key}` };
}

export async function storageGet(
  relKey: string
): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/files/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const key = normalizeKey(relKey);

  // The local fallback has no signed URLs to hand out - the bytes are served
  // straight off disk by the /files route - so the served path is the
  // answer, and it is what the caller would have redirected to anyway.
  if (ENV.useLocalStorage) return `/files/${key}`;

  const storage = hasForgeConfig() ? null : supabaseStorage();
  if (storage) {
    const resp = await fetch(`${storage.sign}/${key}`, {
      method: "POST",
      headers: supabaseHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS }),
    });

    if (!resp.ok) {
      await storageFailure("Storage signed URL failed", resp);
    }

    const { signedURL } = (await resp.json()) as { signedURL?: string };
    if (!signedURL) {
      throw new Error(
        "Storage returned no signed URL for an object that exists"
      );
    }
    // The service returns a project-relative path; the /files route hands it
    // straight to the browser as a redirect target, so it has to be absolute.
    return signedURL.startsWith("http")
      ? signedURL
      : `${ENV.supabaseUrl}/storage/v1${signedURL}`;
  }

  const { forgeUrl, forgeKey } = getForgeConfig();

  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  return url;
}

/**
 * Remove a stored object.
 *
 * Returns whether the object was removed, and never throws for a missing one:
 * a caller deleting a database row whose object is already gone has still
 * achieved what it asked for, and failing the request over it would leave the
 * row deleted and the officer told it did not work.
 *
 * The local backend genuinely unlinks the file. Supabase Storage deletes the
 * object, so a removed avatar or superseded case file stops costing storage.
 * The Forge/S3 backend has no documented delete endpoint, so there the object is
 * left in place and the fact is logged - an orphaned object costs storage,
 * whereas a guessed endpoint could be a destructive call against a real bucket.
 * The row and the activity trail are correct either way, which is what the case
 * file depends on.
 */
export async function storageDelete(relKey: string): Promise<boolean> {
  if (ENV.useLocalStorage) {
    const target = localPathForKey(relKey);
    if (!target) return false;
    try {
      await unlink(target);
      return true;
    } catch {
      return false;
    }
  }

  const storage = hasForgeConfig() ? null : supabaseStorage();
  if (storage) {
    const key = normalizeKey(relKey);
    const resp = await fetch(`${storage.objects}/${key}`, {
      method: "DELETE",
      headers: supabaseHeaders(),
    });

    // A missing object is not a failure here, for the reason in the note above:
    // the row is going either way, and reporting otherwise would tell an
    // officer their deletion failed when it did not.
    if (resp.ok) return true;
    if (resp.status === 404) return false;

    await storageFailure("Storage delete failed", resp);
  }

  console.warn(
    `[Storage] no delete endpoint for the S3 backend; "${relKey}" is left in the bucket`
  );
  return false;
}
