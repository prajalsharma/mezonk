import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, idSchema, ok } from "@/lib/api/http";
import { COMMENT_MAX } from "@/lib/comments/text";
import { requireCap } from "@/lib/api/session";
import { deleteComment, editComment } from "@/server/comments";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

export function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const a = await requireCap(req, "comment:edit:own");
    if (a.res) return a.res;
    const id = idSchema.safeParse((await params).id);
    const body = z.object({ body: z.string().max(COMMENT_MAX * 2) }).safeParse(await req.json().catch(() => null));
    if (!id.success || !body.success) return fail(400, "bad_request", "Invalid comment");
    try {
      return ok({ comment: await editComment(a.v, id.data, body.data.body) }, { maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}

export function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const a = await requireCap(req, "comment:delete:own");
    if (a.res) return a.res;
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Invalid comment");
    try {
      await deleteComment(a.v, id.data);
      return new Response(null, { status: 204 });
    } catch (e) {
      return domainError(e);
    }
  });
}
