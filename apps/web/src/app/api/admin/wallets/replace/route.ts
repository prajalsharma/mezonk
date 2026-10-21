import type { NextRequest } from "next/server";
import { z } from "zod";
import { addressSchema, fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { replaceWallet } from "@/server/admin";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";
const body = z.object({ oldWallet: addressSchema, newWallet: addressSchema, reason: z.string().trim().min(10).max(1000) });

/** Compromised-wallet incident response. Returns what was done now and what is pending on-chain. */
export function POST(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "admin-replace", 5, 60_000)) return fail(429, "rate_limited", "Too many requests");
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(400, "bad_request", "Give both wallets and describe the incident (10+ characters)");
    const a = await requireCap(req, "wallet:replace");
    if (a.res) return a.res;
    try {
      return ok({ report: await replaceWallet(a.v, p.data.oldWallet, p.data.newWallet, p.data.reason) }, { maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
