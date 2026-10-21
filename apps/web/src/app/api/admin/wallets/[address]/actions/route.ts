import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok, rateLimit } from "@/lib/api/http";
import type { Capability } from "@/lib/auth/capabilities";
import { requireCap } from "@/lib/api/session";
import { grantAdmin, inspectWallet, restore, revokeAdmin, revokeSessionsOf, suspend } from "@/server/admin";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";
const body = z.object({
  action: z.enum(["grant_admin", "revoke_admin", "suspend", "restore", "revoke_sessions"]),
  reason: z.string().trim().max(500).default(""),
});
const NEEDS: Record<z.infer<typeof body>["action"], Capability> = {
  grant_admin: "role:grant:admin",
  revoke_admin: "role:revoke:admin",
  suspend: "account:suspend",
  restore: "account:restore",
  revoke_sessions: "session:revoke:any",
};

/** Platform-level account actions. Every one is capability-checked, reasoned and audited. */
export function POST(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  return guarded(async () => {
    if (!rateLimit(req, "admin-action", 30, 60_000)) return fail(429, "rate_limited", "Too many requests");
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(400, "bad_request", "Invalid action");
    const a = await requireCap(req, NEEDS[p.data.action]);
    if (a.res) return a.res;
    const target = (await params).address;
    try {
      const { action, reason } = p.data;
      if (action === "grant_admin") await grantAdmin(a.v, target, reason);
      if (action === "revoke_admin") await revokeAdmin(a.v, target, reason);
      if (action === "suspend") await suspend(a.v, target, reason);
      if (action === "restore") await restore(a.v, target, reason);
      if (action === "revoke_sessions") await revokeSessionsOf(a.v, target, reason || "admin request");
      return ok(await inspectWallet(target), { maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
