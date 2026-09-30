import { ENV } from "./env";
import { localGet } from "../storage";

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
 */
export async function redirectToSignedUrl(key: string): Promise<Response> {
  if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
    return new Response("Storage proxy not configured", { status: 500 });
  }

  try {
    const forgeUrl = new URL(
      "v1/storage/presign/get",
      ENV.forgeApiUrl.replace(/\/+$/, "") + "/",
    );
    forgeUrl.searchParams.set("path", key);

    const forgeResp = await fetch(forgeUrl, {
      headers: { Authorization: `Bearer ${ENV.forgeApiKey}` },
    });

    if (!forgeResp.ok) {
      const body = await forgeResp.text().catch(() => "");
      console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
      return new Response("Storage backend error", { status: 502 });
    }

    const { url } = (await forgeResp.json()) as { url: string };
    if (!url) {
      return new Response("Empty signed URL from backend", { status: 502 });
    }

    return new Response(null, {
      status: 307,
      headers: { "cache-control": "no-store", location: url },
    });
  } catch (err) {
    console.error("[StorageProxy] failed:", err);
    return new Response("Storage proxy error", { status: 502 });
  }
}
