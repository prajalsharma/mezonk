import "server-only";
import { getDb, schema } from "@/server/db/client";

/**
 * Append-only audit entry (the table rejects UPDATE/DELETE at the database level).
 * Never pass secrets, tokens or signatures in `details`.
 */
export async function audit(actor: string, action: string, subjectType: string, subjectId: string, details?: Record<string, unknown>) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({ actor: actor.toLowerCase(), action, subjectType, subjectId: subjectId.toLowerCase(), details: details ?? null });
}
