import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { fail, guarded, idSchema, ok } from "@/lib/api/http";
import { fetchReferenceQuote, sourceName, type ReferenceQuote } from "@/lib/import/external";
import { getDb } from "@/server/db/client";
import { marketProposals } from "@/server/db/schema";
import { importedFrom } from "@/server/governance";

export const dynamic = "force-dynamic";

/** Quotes are cached per source market for two minutes, so page views don't turn into calls to Polymarket or Kalshi. */
const TTL_MS = 120_000;
const cache = new Map<string, { at: number; quote: ReferenceQuote | null; error: string | null }>();

/**
 * For a market imported from Polymarket or Kalshi: that market's current Yes price, read from its public API with
 * the time it was read. It is reference information only: it never settles or prices anything on MEZONK.
 */
export function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Market id must be a positive integer");
    const db = await getDb();
    const [p] = await db.select({ refs: marketProposals.references_ }).from(marketProposals).where(eq(marketProposals.marketId, id.data));
    const ref = p ? importedFrom(p.refs) : null;
    if (!ref) return fail(404, "not_imported", "This market wasn't imported from another prediction market");
    const key = `${ref.source}:${ref.id}`;
    let hit = cache.get(key);
    if (!hit || Date.now() - hit.at > TTL_MS) {
      try {
        hit = { at: Date.now(), quote: await fetchReferenceQuote(ref.source, ref.id), error: null };
      } catch (e) {
        hit = { at: Date.now(), quote: null, error: (e as Error).message };
      }
      cache.set(key, hit);
      if (cache.size > 500) cache.delete(cache.keys().next().value!);
    }
    return ok({ source: ref.source, sourceName: sourceName[ref.source], url: ref.url, quote: hit.quote, unavailable: hit.error ? "Couldn't reach the source just now" : null }, { maxAge: 60 });
  });
}
