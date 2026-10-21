import type { NextRequest } from "next/server";
import { fail, guarded, ok } from "@/lib/api/http";
import { viewer, unauthorized } from "@/lib/api/session";
import { removeOrder } from "@/server/orderbook";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

/** Hide your order from the book. It stays valid on-chain until you cancel it there. */
export function DELETE(req: NextRequest, { params }: { params: Promise<{ hash: string }> }) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!v) return unauthorized();
    const { hash } = await params;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return fail(400, "bad_request", "Invalid order hash");
    try {
      return ok(await removeOrder(hash, v.wallet), { maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
