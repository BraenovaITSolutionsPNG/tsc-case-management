"use client";

import { trpc } from "@/lib/trpc";
import { invalidateSession } from "@/lib/queryInvalidation";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Camera, Loader2, Trash2 } from "lucide-react";

/**
 * Officer portrait.
 *
 * Uploads go through the `auth.uploadAvatar` mutation, which sniffs the magic
 * number server-side and derives the extension from it - the browser-supplied
 * name is never trusted for the content type. The object is served back through
 * the storage proxy by key, so the component only ever holds a key.
 */
export function AvatarUpload({
  avatarKey,
  name,
  size = 40,
  onChange,
  canEdit = true,
}: {
  avatarKey?: string | null;
  name?: string | null;
  size?: number;
  onChange?: (key: string | null) => void;
  canEdit?: boolean;
}) {
  const utils = trpc.useUtils();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const upload = trpc.auth.uploadAvatar.useMutation();
  const remove = trpc.auth.removeAvatar.useMutation({
    onSuccess: () => {
      void invalidateSession(utils);
      onChange?.(null);
      toast.success("Photo removed.");
    },
    onError: error => toast.error(error.message),
  });

  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? "")
    .join("");

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      // The server re-sniffs the bytes and rejects a mismatch, so a renamed
      // script cannot be stored under an image type. Sending the browser's
      // declared type is what makes that comparison possible.
      const mimeType = file.type as "image/png" | "image/jpeg" | "image/webp";
      if (!["image/png", "image/jpeg", "image/webp"].includes(mimeType)) {
        toast.error("Only PNG, JPEG or WebP images are accepted.");
        return;
      }

      const result = await upload.mutateAsync({
        data: await toBase64(file),
        mimeType,
      });
      void invalidateSession(utils);
      onChange?.(result.avatarKey);
      toast.success("Photo updated.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="flex items-center gap-3">
      <div
        className="relative shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100"
        style={{ width: size, height: size }}
      >
        {avatarKey ? (
          // Served through the storage proxy, so this is a plain img rather
          // than next/image: the proxy already handles content type and the
          // response is a signed redirect, not an optimisable asset.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/files/${avatarKey}`}
            alt={name ? `${name}'s photo` : "Officer photo"}
            // The photo is square and the box around it is fixed at `size`, so
            // the dimensions are stated rather than left to layout. The
            // attributes are also what stops the image being laid out at 0x0
            // until the storage proxy has answered.
            width={size}
            height={size}
            className="h-full w-full object-cover"
          />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center font-semibold text-slate-500"
            style={{ fontSize: size * 0.36 }}
          >
            {initials}
          </span>
        )}

        {uploading ? (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </span>
        ) : null}
      </div>

      {canEdit ? (
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            id="officer-photo"
            name="photo"
            type="file"
            accept="image/*"
            className="hidden"
            onChange={event => handleFile(event.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className={cn(
              "inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            )}
          >
            <Camera className="h-3.5 w-3.5" />
            Change photo
          </button>
          {avatarKey ? (
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="inline-flex items-center gap-1.5 rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      // The mutation schema wants the payload without the data-URL prefix.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}
