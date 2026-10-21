import type { NextRequest } from "next/server";
import { fail, guarded, ok } from "@/lib/api/http";
import { lt } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { runIndexerTick } from "@/server/indexer/indexer";
import { cleanupPendingMedia } from "@/server/media";
import { sweepStaleOrders } from "@/server/orderbook";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scheduled indexer run (e.g. Vercel Cron). Requires `Authorization: Bearer $CRON_SECRET`. */
export function GET(req: NextRequest) {
  return guarded(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return fail(401, "unauthorized", "Missing or invalid cron secret");
    }
    const tick = await runIndexerTick();
    // Housekeeping: abandoned uploads, spent nonces, expired sessions (retention: 30 days after expiry).
    const mediaRemoved = await cleanupPendingMedia().catch(() => -1);
    // Signed orders whose makers lost funding or approval leave the book (and return if it comes back).
    const orders = await sweepStaleOrders().catch(() => null);
    const db = await getDb();
    await db.delete(schema.authNonces).where(lt(schema.authNonces.expiresAt, new Date(Date.now() - 86_400_000))).catch(() => undefined);
    await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date(Date.now() - 30 * 86_400_000))).catch(() => undefined);
    return ok({ ...tick, mediaRemoved, orders }, { maxAge: 0 });
  });
}
