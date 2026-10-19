import { and, asc, eq } from "drizzle-orm";
import { deployment } from "@/lib/chain/config";
import { guarded, ok } from "@/lib/api/http";
import { getDb, schema } from "@/server/db/client";

export const dynamic = "force-dynamic";

/**
 * Resolvers approved by the owner, replayed from indexed ResolverUpdated events (latest event wins).
 * The create flow re-checks the chosen address with isResolver() on-chain before signing.
 */
export function GET() {
  return guarded(async () => {
    const db = await getDb();
    const rows = await db
      .select({ args: schema.chainEvents.args, block: schema.chainEvents.blockNumber })
      .from(schema.chainEvents)
      .where(and(eq(schema.chainEvents.chainId, deployment.chainId), eq(schema.chainEvents.eventName, "ResolverUpdated")))
      .orderBy(asc(schema.chainEvents.blockNumber), asc(schema.chainEvents.logIndex));
    const state = new Map<string, boolean>();
    for (const r of rows) {
      const a = r.args as { resolver: string; approved: boolean };
      state.set(a.resolver.toLowerCase(), Boolean(a.approved));
    }
    return ok({ resolvers: [...state].filter(([, v]) => v).map(([address]) => ({ address })) }, { maxAge: 30 });
  });
}
