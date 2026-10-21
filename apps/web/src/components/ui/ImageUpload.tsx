"use client";

import { ImagePlus, Loader2, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { useSession } from "@/hooks/useSession";
import { apiAuth } from "@/lib/api/auth-client";

export interface UploadedImage {
  id: string;
  url: string;
  width: number;
  height: number;
}

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const MAX = 5 * 1024 * 1024;

/**
 * Uploads one image through /api/media. The server checks the real file signature and re-encodes it;
 * a failed upload is shown as an error and never as a preview.
 */
export function ImageUpload({
  kind,
  value,
  onChange,
  label,
  hint,
  shape = "wide",
}: {
  kind: "avatar" | "cover" | "context";
  value: UploadedImage | null;
  onChange: (v: UploadedImage | null) => void;
  label: string;
  hint?: string;
  shape?: "wide" | "round" | "square";
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const session = useSession();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function pick(file: File) {
    setErr(null);
    if (file.size > MAX) return setErr("Images must be 5 MB or smaller.");
    if (!ACCEPT.split(",").includes(file.type)) return setErr("Use a PNG, JPEG, WebP or GIF image.");
    setBusy(true);
    try {
      if (!(await session.ensure())) return;
      const form = new FormData();
      form.set("file", file);
      form.set("kind", kind);
      onChange(await apiAuth<UploadedImage>("/api/media", { method: "POST", body: form }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const box = shape === "round" ? "size-24 rounded-full" : shape === "square" ? "size-28 rounded-md" : "aspect-[16/9] w-full rounded-md";
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-ink">{label}</label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className={cx("press relative flex items-center justify-center overflow-hidden border border-dashed border-line bg-sunk text-muted transition-colors hover:border-ink-2/50 hover:text-ink", box)}
          aria-label={value ? `Replace ${label.toLowerCase()}` : `Upload ${label.toLowerCase()}`}
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value.url} alt="" className="size-full object-cover" />
          ) : busy ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <ImagePlus className="size-5" />
          )}
        </button>
        {value && (
          <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink">
            <X className="size-4" /> Remove
          </button>
        )}
      </div>
      <input ref={input} id={id} type="file" accept={ACCEPT} className="sr-only" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
      {err ? <p className="text-sm text-danger" role="alert">{err}</p> : hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}
