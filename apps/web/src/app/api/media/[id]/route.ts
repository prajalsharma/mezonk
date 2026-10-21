import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { getMedia, removeMedia } from "@/server/media";
import { domainError } from "@/server/route-errors";
import { readLocal } from "@/server/storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serves locally stored images. Always re-encoded WebP; headers forbid sniffing and scripting even if a
 * browser misinterprets the bytes. Removed images 404.
 */
export function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail(404, "not_found", "No such image");
    const m = await getMedia(id);
    if (!m || m.status === "removed" || m.provider !== "local") return fail(404, "not_found", "No such image");
    const bytes = await readLocal(m.storageKey);
    if (!bytes) return fail(404, "not_found", "No such image");
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": "image/webp",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "content-disposition": "inline",
        "cache-control": m.status === "attached" ? "public, max-age=31536000, immutable" : "private, max-age=60",
      },
    });
  });
}

/** Moderators remove an image (reason required). */
export function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const a = await requireCap(req, "media:moderate");
    if (a.res) return a.res;
    const { id } = await params;
    const reason = req.nextUrl.searchParams.get("reason")?.trim() ?? "";
    if (!z.string().uuid().safeParse(id).success || reason.length < 5) return fail(400, "bad_request", "Give a reason (5+ characters)");
    try {
      await removeMedia(a.v.wallet, id, reason);
      return new Response(null, { status: 204 });
    } catch (e) {
      return domainError(e);
    }
  });
}
