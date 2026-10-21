import type { NextRequest } from "next/server";
import { z } from "zod";
import { addressSchema, fail, guarded, idSchema, ok, parseQuery, rateLimit } from "@/lib/api/http";
import { ordersOf, signedOrderSchema, submitOrder } from "@/server/orderbook";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

/**
 * Add a signed order to the book. The EIP-712 signature is the maker's authorization, so no session is needed;
 * the server checks it, the market stage, cancellation, nonce, funding and that it doesn't cross, then stores it.
 * Accepted means "resting in the book", never "traded".
 */
export function POST(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "orders", 30, 60_000)) return fail(429, "rate_limited", "Too many orders. Wait a minute.");
    const body = signedOrderSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) return fail(400, "bad_request", "Invalid order", body.error.flatten());
    try {
      return ok(await submitOrder(body.data), { status: 201, maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}

const q = z.object({ maker: addressSchema, market: idSchema.optional() });

/** A wallet's signed and escrowed orders (public: the book is public). */
export function GET(req: NextRequest) {
  return guarded(async () => {
    const p = parseQuery(req, q);
    if (!p.success) return fail(400, "bad_request", "Pass ?maker=0x…");
    return ok(await ordersOf(p.data.maker, p.data.market), { maxAge: 0 });
  });
}
