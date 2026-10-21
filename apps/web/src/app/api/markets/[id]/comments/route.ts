import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, idSchema, ok, rateLimit } from "@/lib/api/http";
import { COMMENT_MAX } from "@/lib/comments/text";
import { requireCap, viewer } from "@/lib/api/session";
import { createComment, listComments } from "@/server/comments";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

/** Public, paginated. Signed-in viewers additionally see their own hidden comments and per-item permissions. */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const id = idSchema.safeParse((await params).id);
    const before = z.coerce.number().int().positive().optional().safeParse(req.nextUrl.searchParams.get("before") ?? undefined);
    if (!id.success || !before.success) return fail(400, "bad_request", "Invalid market or cursor");
    return ok(await listComments(id.data, await viewer(req), before.data), { maxAge: 0 });
  });
}

export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    if (!rateLimit(req, "comment", 20, 60_000)) return fail(429, "rate_limited", "Too many requests");
    if (Number(req.headers.get("content-length") ?? 0) > COMMENT_MAX * 4 + 1024) return fail(413, "too_large", "Comment is too long");
    const a = await requireCap(req, "comment:create");
    if (a.res) return a.res;
    const id = idSchema.safeParse((await params).id);
    const body = z.object({ body: z.string().max(COMMENT_MAX * 2) }).safeParse(await req.json().catch(() => null));
    if (!id.success || !body.success) return fail(400, "bad_request", "Invalid comment");
    try {
      return ok({ comment: await createComment(a.v, id.data, body.data.body) }, { status: 201, maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
