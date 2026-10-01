// Object storage for case files and avatars.
//
// Two backends. Development writes to a directory under the project, so nothing
// is needed to work on the app offline. Anything deployed presigns through
// BUILT_IN_FORGE_API_* and PUTs straight to S3 — see `storagePut`. Downloads are
// served from /files/{key}, which answers a 307 to a signed read when the object
// is in a bucket and reads the bytes off disk when it is not.

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
  return path.resolve(import.meta.dirname ?? process.cwd(), "..", ".local-storage");
}

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
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
 * The local backend genuinely unlinks the file. The Forge/S3 backend has no
 * documented delete endpoint, so there the object is left in place and the fact
 * is logged - an orphaned object costs storage, whereas a guessed endpoint
 * could be a destructive call against a real bucket. The row and the activity
 * trail are correct either way, which is what the case file depends on.
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
  console.warn(
    `[Storage] no delete endpoint for the S3 backend; "${relKey}" is left in the bucket`
  );
  return false;
}
