import type { NextRequest } from "next/server";
import { z } from "zod";
import { addressSchema, fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { createSession, siteFromRequest } from "@/server/auth";

export const dynamic = "force-dynamic";
const body = z.object({ wallet: addressSchema, nonce: z.string().regex(/^[0-9a-f]{32}$/), issuedAt: z.string().datetime(), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

export function POST(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "session", 20, 60_000)) return fail(429, "rate_limited", "Too many requests");
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(400, "bad_request", "Invalid sign-in payload");
    const s = await createSession(p.data.wallet, p.data.nonce, p.data.issuedAt, p.data.signature as `0x${string}`, siteFromRequest(req));
    if (!s) return fail(401, "bad_signature", "Signature or nonce is invalid or expired");
    return ok({ ...s, wallet: p.data.wallet }, { maxAge: 0 });
  });
}
