import type { NextRequest } from "next/server";
import { guarded, ok } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { inspectWallet } from "@/server/admin";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

/** Everything about one wallet: profile, status, live protocol roles, platform roles, sessions, history. */
export function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  return guarded(async () => {
    const a = await requireCap(req, "audit:read");
    if (a.res) return a.res;
    try {
      return ok(await inspectWallet((await params).address), { maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
