import type { NextRequest } from "next/server";
import { fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { MAX_UPLOAD_BYTES, MEDIA_KINDS, type MediaKind } from "@/lib/media/sniff";
import { requireCap } from "@/lib/api/session";
import { uploadImage } from "@/server/media";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Multipart upload: field `file` (image) and `kind` (avatar | cover | context). Returns a pending media id. */
export function POST(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "media", 20, 60_000)) return fail(429, "rate_limited", "Too many uploads. Wait a minute.");
    const a = await requireCap(req, "media:upload");
    if (a.res) return a.res;
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES + 64 * 1024) return fail(413, "too_large", "Images must be 5 MB or smaller");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const kind = String(form?.get("kind") ?? "");
    if (!(file instanceof Blob) || !MEDIA_KINDS.includes(kind as MediaKind)) return fail(400, "bad_request", "Send an image in `file` and a valid `kind`");
    try {
      const out = await uploadImage(a.v.wallet, kind as MediaKind, Buffer.from(await file.arrayBuffer()));
      return ok(out, { status: 201, maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
