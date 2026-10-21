import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, idSchema, ok, rateLimit } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { reportComment } from "@/server/comments";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    if (!rateLimit(req, "report", 10, 60_000)) return fail(429, "rate_limited", "Too many requests");
    const a = await requireCap(req, "comment:report");
    if (a.res) return a.res;
    const id = idSchema.safeParse((await params).id);
    const body = z.object({ reason: z.string().max(300) }).safeParse(await req.json().catch(() => null));
    if (!id.success || !body.success) return fail(400, "bad_request", "Invalid report");
    try {
      await reportComment(a.v, id.data, body.data.reason);
      return ok({ ok: true }, { status: 201, maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
