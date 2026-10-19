import type { NextRequest } from "next/server";
import { fail, guarded, idSchema, ok, rateLimit } from "@/lib/api/http";
import { indexer } from "@/server/indexer/indexer";

export const dynamic = "force-dynamic";

/**
 * Pull new chain events, re-derive this market from its raw events and reconcile it against
 * contract reads. Safe to call publicly: it only ever copies chain state, never writes it.
 */
export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    if (!rateLimit(req, "refresh", 6, 60_000)) return fail(429, "rate_limited", "Refreshed recently. Try again in a minute.");
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Market id must be a positive integer");
    const tick = await indexer.runTick();
    await indexer.rebuildMarket(id.data);
    const mismatches = await indexer.reconcile(1, [id.data]);
    return ok({ tick, mismatches }, { maxAge: 0 });
  });
}
