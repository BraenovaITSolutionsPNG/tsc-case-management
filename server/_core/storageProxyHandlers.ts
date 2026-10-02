import { localGet, storageGetSignedUrl } from "../storage";

/**
 * The remote half of the storage proxy, expressed as a `Response` rather than
 * an Express one so the App Router route can return it directly.
 */

/** Reads a stored object from the local-disk development backend. */
export async function readStoredObject(key: string): Promise<Buffer | null> {
  return localGet(key);
}

/**
 * Exchanges a storage key for a short-lived signed URL and answers with a
 * redirect to it, so the bytes never pass through this process.
 *
 * The URL comes from `storageGetSignedUrl`, which is the only place that knows
 * how a signed read is obtained. This function used to carry a second copy of
 * that logic, written against the Forge presigner alone, and the two halves
 * drifted: uploads went through the bucket while every download answered "Storage
 * proxy not configured" with a 500 — a profile image that saved and then would
 * not display, and no error anywhere near the cause. The duplication is the
 * defect, so it is gone rather than extended: one implementation, reached from
 * both ends, and a backend added to it once.
 */
export async function redirectToSignedUrl(key: string): Promise<Response> {
  try {
    const url = await storageGetSignedUrl(key);

    return new Response(null, {
      status: 307,
      headers: { "cache-control": "no-store", location: url },
    });
  } catch (err) {
    // `storageGetSignedUrl` names the backend and the reason, so this says what
    // went wrong rather than only that something did. An officer chasing a blank
    // image is otherwise looking at "Storage proxy error" and no cause.
    console.error("[StorageProxy] failed:", err);
    return new Response("Storage proxy error", { status: 502 });
  }
}
