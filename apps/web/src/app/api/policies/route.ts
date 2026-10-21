import { asc } from "drizzle-orm";
import { guarded, ok } from "@/lib/api/http";
import { getDb, schema } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** Every on-chain policy version (indexed from PolicyAdded / PolicyActiveSet). Immutable once added. */
export function GET() {
  return guarded(async () => {
    const db = await getDb();
    const rows = await db.select().from(schema.policies).orderBy(asc(schema.policies.policyId));
    return ok({ policies: rows }, { maxAge: 10 });
  });
}
