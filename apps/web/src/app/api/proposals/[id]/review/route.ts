import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok } from "@/lib/api/http";
import { unauthorized, viewer } from "@/lib/api/session";
import { reviewActionSchema } from "@/lib/governance/proposal";
import { curatorAction, GovernanceError } from "@/server/governance";

export const dynamic = "force-dynamic";

/** Curator actions. Authorization is re-checked against the contract's curator list on every call. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!v) return unauthorized();
    const { id } = await params;
    const p = reviewActionSchema.safeParse(await req.json().catch(() => null));
    if (!p.success || !z.string().uuid().safeParse(id).success) return fail(400, "bad_request", "Invalid review action", p.success ? undefined : p.error.flatten());
    try {
      const row = await curatorAction(id, v, p.data);
      return ok({ id: row.id, status: row.status }, { maxAge: 0 });
    } catch (e) {
      if (e instanceof GovernanceError) return fail(e.status, e.code, e.message);
      throw e;
    }
  });
}
