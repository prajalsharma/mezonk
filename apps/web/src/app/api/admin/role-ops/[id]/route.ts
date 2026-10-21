import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { attachRoleTx, reconcileRoleOperation } from "@/server/admin";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";
const idSchema = z.string().uuid();

/** Re-checks the operation against the chain (idempotent). */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const a = await requireCap(req, "audit:read");
    if (a.res) return a.res;
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Invalid id");
    try {
      return ok({ operation: await reconcileRoleOperation(id.data) }, { maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}

/** Attaches the owner's transaction hash; status becomes confirmed only from the receipt + chain state. */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const a = await requireCap(req, "role:operation:create");
    if (a.res) return a.res;
    const id = idSchema.safeParse((await params).id);
    const body = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).safeParse(await req.json().catch(() => null));
    if (!id.success || !body.success) return fail(400, "bad_request", "Give a transaction hash");
    try {
      return ok({ operation: await attachRoleTx(a.v, id.data, body.data.txHash as `0x${string}`) }, { maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
