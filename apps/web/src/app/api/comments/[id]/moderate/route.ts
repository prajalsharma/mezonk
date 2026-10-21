import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, idSchema, ok } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { moderateComment } from "@/server/comments";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const a = await requireCap(req, "comment:moderate");
    if (a.res) return a.res;
    const id = idSchema.safeParse((await params).id);
    const body = z.object({ action: z.enum(["hide", "restore"]), reason: z.string().max(500) }).safeParse(await req.json().catch(() => null));
    if (!id.success || !body.success) return fail(400, "bad_request", "Invalid moderation request");
    try {
      await moderateComment(a.v, id.data, body.data.action, body.data.reason);
      return ok({ ok: true }, { maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
