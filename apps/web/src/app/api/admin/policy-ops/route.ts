import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { policySchema } from "@/lib/orderbook/policy";
import { createPolicyOperation, listPolicyOperations } from "@/server/admin";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("fn", [
  z.object({ fn: z.literal("addPolicy"), policy: policySchema, reason: z.string().trim().min(5).max(500) }),
  z.object({ fn: z.literal("setPolicyActive"), policyId: z.number().int().min(1), active: z.boolean(), reason: z.string().trim().min(5).max(500) }),
]);

/** Records a requested policy change. The exchange owner still has to sign it; it applies to NEW markets only. */
export function POST(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "policy-op", 20, 60_000)) return fail(429, "rate_limited", "Too many requests");
    const a = await requireCap(req, "role:operation:create");
    if (a.res) return a.res;
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(400, "bad_request", "Invalid policy request", p.error.flatten());
    try {
      const { reason, ...op } = p.data;
      return ok({ operation: await createPolicyOperation(a.v, op, reason) }, { status: 201, maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}

export function GET(req: NextRequest) {
  return guarded(async () => {
    const a = await requireCap(req, "audit:read");
    if (a.res) return a.res;
    return ok({ operations: await listPolicyOperations() }, { maxAge: 0 });
  });
}
