import { ENV } from "@server/_core/env";
import {
  readStoredObject,
  redirectToSignedUrl,
} from "@server/_core/storageProxyHandlers";
import { authenticateSupabaseRequest } from "@server/_core/supabaseSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves a stored object by key.
 *
 * The Express route used a wildcard path and read `req.params[0]`; App Router
 * expresses the same thing as a catch-all segment, so `cases/13/file.pdf`
 * arrives as a string array that is rejoined here. The URL shape itself is
 * unchanged, so every key already in the database still resolves.
 *
 * Session-guarded, because the key alone is not a secret. Nothing checked who
 * was asking: an officer who copied a document's address out of the case file
 * handed it to anybody who asked, and the 60-second lifetime on the signed URL
 * bounded the *URL* rather than the route that mints one — so the same request
 * could be repeated forever and a fresh 60 seconds minted each time. These are
 * case files: teacher names and disciplinary records, on the same footing as the
 * register that the row-level-security migration in `drizzle/` exists to keep
 * off the public API.
 *
 * A signed-in officer is enough, deliberately. The register is not narrowed per
 * account (`shared/access.ts` gives every tier `matter:viewAll` over the whole
 * province), so there is no per-matter capability to check here that the case
 * file does not already sit behind.
 *
 * The refusals are separated by the same message-prefix convention
 * `server/_core/context.ts` uses, because the two faults have opposite fixes: an
 * unreachable database is not the officer's account and must not read as one.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ key?: string[] }> }
): Promise<Response> {
  const { key: segments } = await params;
  const key = segments?.join("/");

  if (!key) {
    return new Response("Missing storage key", { status: 400 });
  }

  try {
    const user = await authenticateSupabaseRequest();
    if (!user) {
      // 404 rather than 401: an anonymous caller should not learn that this key
      // names anything at all, and a document that does not exist answers the
      // same way.
      return new Response("Not found", { status: 404 });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/^The platform cannot reach its database/.test(message)) {
      console.error(
        "[Files] storage request could not be authorised:",
        message
      );
      return new Response("Service unavailable", { status: 503 });
    }
    console.warn("[Files] refusing a stored object:", message);
    return new Response("Forbidden", { status: 403 });
  }

  // Development fallback: serve the bytes straight off disk. Same path, same
  // key, so nothing above this route has to know which backend answered.
  if (ENV.useLocalStorage) {
    const bytes = await readStoredObject(key);
    if (!bytes) {
      return new Response("Not found", { status: 404 });
    }
    // The type comes from the extension the uploader chose, which the server
    // derived from the sniffed magic number - so a stored object is always
    // labelled with a type its bytes actually support.
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": contentTypeForKey(key),
        "x-content-type-options": "nosniff",
      },
    });
  }

  return redirectToSignedUrl(key);
}

/**
 * The content type to serve a stored object as.
 *
 * Taken from the extension rather than a stored column, because the uploader
 * derived the extension from the file's magic number, so the extension is
 * already a checked claim about the bytes. An unknown extension gets
 * application/octet-stream, which downloads rather than renders - the safe
 * default for a type we cannot vouch for.
 */
function contentTypeForKey(key: string): string {
  const extension = key.slice(key.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "pdf":
      return "application/pdf";
    case "txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
