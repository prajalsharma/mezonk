import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { guarded, ok } from "@/lib/api/http";
import { unauthorized, viewer } from "@/lib/api/session";
import { getDb, schema } from "@/server/db/client";
import { myProfile } from "@/server/profiles";

export const dynamic = "force-dynamic";

/** Roles (from chain) and settings for the signed-in wallet. */
export function GET(req: NextRequest) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!v) return unauthorized();
    const db = await getDb();
    const [settings] = await db.select().from(schema.userSettings).where(eq(schema.userSettings.wallet, v.wallet));
    return ok({ roles: v, settings: settings ?? null, profile: await myProfile(v.wallet) }, { maxAge: 0 });
  });
}
