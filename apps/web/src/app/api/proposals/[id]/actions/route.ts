import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok } from "@/lib/api/http";
import { unauthorized, viewer } from "@/lib/api/session";
import { authorAction, GovernanceError } from "@/server/governance";

export const dynamic = "force-dynamic";
const body = z.object({ action: z.enum(["submit", "withdraw"]) });

/** Author-side transitions. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!v) return unauthorized();
    const { id } = await params;
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success || !z.string().uuid().safeParse(id).success) return fail(400, "bad_request", "Invalid request");
    try {
      const row = await authorAction(id, v.wallet, p.data.action);
      return ok({ id: row.id, status: row.status }, { maxAge: 0 });
    } catch (e) {
      if (e instanceof GovernanceError) return fail(e.status, e.code, e.message);
      throw e;
    }
  });
}
