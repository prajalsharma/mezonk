import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok, parseQuery } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { listAudit } from "@/server/admin";

export const dynamic = "force-dynamic";
const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50), before: z.coerce.number().int().positive().optional() });

/** Full audit trail (administrators). The public per-proposal trail stays at /api/audit. */
export function GET(req: NextRequest) {
  return guarded(async () => {
    const a = await requireCap(req, "audit:read");
    if (a.res) return a.res;
    const p = parseQuery(req, q);
    if (!p.success) return fail(400, "bad_request", "Invalid query");
    return ok({ entries: await listAudit(p.data.limit, p.data.before) }, { maxAge: 0 });
  });
}
