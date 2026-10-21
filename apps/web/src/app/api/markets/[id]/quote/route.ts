import type { NextRequest } from "next/server";
import { z } from "zod";
import { addressSchema, fail, guarded, idSchema, ok, parseQuery, rateLimit } from "@/lib/api/http";
import { LOT } from "@/lib/orderbook/math";
import { quoteFor } from "@/server/orderbook";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

const q = z.object({
  outcome: z.coerce.number().int().min(0).max(1),
  side: z.coerce.number().int().min(0).max(1),
  quantity: z.string().regex(/^\d{1,40}$/),
  limit: z.coerce.number().int().min(1).max(99),
  taker: addressSchema.optional(),
});

/** Exact fill preview plus the maker orders to pass to `take`. Funding of each signed maker is re-checked live. */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    if (!rateLimit(req, "quote", 120, 60_000)) return fail(429, "rate_limited", "Too many quote requests");
    const id = idSchema.safeParse((await params).id);
    const p = parseQuery(req, q);
    if (!id.success || !p.success) return fail(400, "bad_request", "Invalid quote request");
    const quantity = BigInt(p.data.quantity);
    if (quantity === 0n || quantity % LOT !== 0n) return fail(422, "bad_lot", "Quantity must be a positive multiple of 0.01 shares");
    try {
      const r = await quoteFor(id.data, { ...p.data, quantity });
      return new Response(JSON.stringify(r), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    } catch (e) {
      return domainError(e);
    }
  });
}
