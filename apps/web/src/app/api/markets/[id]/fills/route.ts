import { desc, eq } from "drizzle-orm";
import { fail, guarded, idSchema, ok } from "@/lib/api/http";
import { getDb, schema } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** Confirmed on-chain fills, newest first. The only source of trade prices. */
export function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Market id must be a positive integer");
    const db = await getDb();
    const rows = await db.select().from(schema.fills).where(eq(schema.fills.marketId, id.data)).orderBy(desc(schema.fills.blockNumber), desc(schema.fills.eventId)).limit(100);
    return ok({ fills: rows });
  });
}
