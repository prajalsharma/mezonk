import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok, parseQuery } from "@/lib/api/http";
import { publicAudit } from "@/server/governance";

export const dynamic = "force-dynamic";
const q = z.object({ type: z.enum(["proposal", "project"]), id: z.string().max(64) });

/** Public audit trail: who did what and when. Reasons live on the proposal page; internal notes are never exposed. */
export function GET(req: NextRequest) {
  return guarded(async () => {
    const p = parseQuery(req, q);
    if (!p.success) return fail(400, "bad_request", "type and id are required");
    return ok({ entries: await publicAudit(p.data.type, p.data.id) }, { maxAge: 10 });
  });
}
