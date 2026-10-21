import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { slugForMarket } from "@/lib/market/slug";
import { getDb, schema } from "@/server/db/client";

const { markets, marketSlugs } = schema;

/**
 * Assigns a slug to every market that has none (new markets and the one-time backfill of existing ones).
 * Never changes an existing slug. Uniqueness is enforced by the slug primary key; on a race the insert
 * is skipped and the next tick retries.
 */
export async function ensureSlugs(): Promise<number> {
  const db = await getDb();
  const missing = await db
    .select({ id: markets.marketId, question: markets.question })
    .from(markets)
    .leftJoin(marketSlugs, and(eq(marketSlugs.marketId, markets.marketId), eq(marketSlugs.isCurrent, true)))
    .where(isNull(marketSlugs.slug))
    .orderBy(markets.marketId);
  let added = 0;
  for (const m of missing) {
    const taken = new Set<string>();
    const probe = slugForMarket(m.question, m.id, () => false);
    const hit = await db.select({ slug: marketSlugs.slug }).from(marketSlugs).where(eq(marketSlugs.slug, probe));
    if (hit.length) taken.add(probe);
    const slug = slugForMarket(m.question, m.id, (s) => taken.has(s));
    const r = await db.insert(marketSlugs).values({ slug, marketId: m.id, isCurrent: true }).onConflictDoNothing().returning();
    added += r.length;
  }
  return added;
}

export async function marketIdForSlug(slug: string): Promise<{ id: number; current: string } | null> {
  const db = await getDb();
  const [row] = await db.select().from(marketSlugs).where(eq(marketSlugs.slug, slug.toLowerCase()));
  if (!row) return null;
  if (row.isCurrent) return { id: row.marketId, current: row.slug };
  const [cur] = await db.select().from(marketSlugs).where(and(eq(marketSlugs.marketId, row.marketId), eq(marketSlugs.isCurrent, true)));
  return { id: row.marketId, current: cur?.slug ?? row.slug };
}

export async function slugsFor(ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const db = await getDb();
  const rows = await db.select().from(marketSlugs).where(and(inArray(marketSlugs.marketId, ids), eq(marketSlugs.isCurrent, true)));
  return new Map(rows.map((r) => [r.marketId, r.slug]));
}
