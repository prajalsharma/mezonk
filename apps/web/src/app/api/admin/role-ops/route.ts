import type { NextRequest } from "next/server";
import { z } from "zod";
import { addressSchema, fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { createRoleOperation } from "@/server/admin";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";
const body = z.object({ fn: z.enum(["setCreator", "setCurator"]), target: addressSchema, grant: z.boolean(), reason: z.string().trim().min(5).max(500) });

/** Records a requested on-chain role change. The contract owner still has to sign it. */
export function POST(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "role-op", 20, 60_000)) return fail(429, "rate_limited", "Too many requests");
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(400, "bad_request", "Invalid role operation (reason needs 5+ characters)");
    const a = await requireCap(req, "role:operation:create");
    if (a.res) return a.res;
    try {
      return ok({ operation: await createRoleOperation(a.v, p.data.fn, p.data.target, p.data.grant, p.data.reason) }, { status: 201, maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
