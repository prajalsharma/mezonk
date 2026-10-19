import type { NextRequest } from "next/server";
import { fail, guarded, ok } from "@/lib/api/http";
import { runIndexerTick } from "@/server/indexer/indexer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Scheduled indexer run (e.g. Vercel Cron). Requires `Authorization: Bearer $CRON_SECRET`. */
export function GET(req: NextRequest) {
  return guarded(async () => {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
      return fail(401, "unauthorized", "Missing or invalid cron secret");
    }
    return ok(await runIndexerTick(), { maxAge: 0 });
  });
}
