import type { NextRequest } from "next/server";
import { addressSchema, fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { issueNonce, siteFromRequest } from "@/server/auth";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "nonce", 30, 60_000)) return fail(429, "rate_limited", "Too many requests");
    const a = addressSchema.safeParse(req.nextUrl.searchParams.get("wallet"));
    if (!a.success) return fail(400, "bad_request", "wallet must be an address");
    return ok(await issueNonce(a.data, siteFromRequest(req)), { maxAge: 0 });
  });
}
