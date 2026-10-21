import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { bootstrapStatus, closeBootstrap } from "@/server/admin";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return guarded(async () => {
    const a = await requireCap(req, "audit:read");
    if (a.res) return a.res;
    return ok(await bootstrapStatus(), { maxAge: 0 });
  });
}

/** Permanently ends the INITIAL_ADMIN_WALLETS bootstrap. */
export function POST(req: NextRequest) {
  return guarded(async () => {
    const a = await requireCap(req, "role:grant:admin");
    if (a.res) return a.res;
    const p = z.object({ reason: z.string().trim().min(5).max(500) }).safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(400, "bad_request", "Give a reason (5+ characters)");
    return ok(await closeBootstrap(a.v.wallet, p.data.reason), { maxAge: 0 });
  });
}
