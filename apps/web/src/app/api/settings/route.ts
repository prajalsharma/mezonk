import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok } from "@/lib/api/http";
import { unauthorized, viewer } from "@/lib/api/session";
import { getDb, schema } from "@/server/db/client";

export const dynamic = "force-dynamic";
const body = z.object({
  displayName: z.string().trim().max(40).optional().nullable(),
  notifyProposals: z.boolean().optional(),
  notifyResolution: z.boolean().optional(),
  notifyClaims: z.boolean().optional(),
  numberFormat: z.enum(["compact", "full"]).optional(),
  hideBalances: z.boolean().optional(),
});

export function PUT(req: NextRequest) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!v) return unauthorized();
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(400, "bad_request", "Invalid settings", p.error.flatten());
    const db = await getDb();
    const [row] = await db
      .insert(schema.userSettings)
      .values({ wallet: v.wallet, ...p.data, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.userSettings.wallet, set: { ...p.data, updatedAt: new Date() } })
      .returning();
    return ok({ settings: row }, { maxAge: 0 });
  });
}
