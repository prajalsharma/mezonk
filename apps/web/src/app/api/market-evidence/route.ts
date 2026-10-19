import type { NextRequest } from "next/server";
import { verifyMessage } from "viem";
import { z } from "zod";
import { addressSchema, fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { evidenceMessage } from "@/lib/market/evidence";
import { getDb, schema } from "@/server/db/client";
import { getMarket } from "@/server/queries";

export const dynamic = "force-dynamic";

const body = z.object({
  marketId: z.number().int().positive(),
  url: z
    .string()
    .trim()
    .url()
    .max(400)
    .refine((u) => u.startsWith("https://"), "Use an https:// link"),
  note: z.string().trim().min(10).max(500),
  author: addressSchema,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

/**
 * Stores a wallet-signed evidence link. The URL is never fetched server-side (no SSRF surface);
 * it is shown to users as unverified, user-submitted material. It has no effect on settlement.
 */
export function POST(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "evidence", 10, 60_000)) return fail(429, "rate_limited", "Too many submissions. Try again shortly.");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid_evidence", "Invalid evidence submission", parsed.error.flatten());
    const { marketId, url, note, author, signature } = parsed.data;
    if (!(await getMarket(marketId))) return fail(404, "not_found", "No indexed market with this id");
    const valid = await verifyMessage({
      address: author as `0x${string}`,
      message: evidenceMessage(marketId, url, note),
      signature: signature as `0x${string}`,
    }).catch(() => false);
    if (!valid) return fail(401, "bad_signature", "The signature does not match the submitting wallet");
    const db = await getDb();
    const [row] = await db.insert(schema.evidence).values({ marketId, url, note, author, signature }).returning();
    return ok({ evidence: row }, { status: 201, maxAge: 0 });
  });
}
