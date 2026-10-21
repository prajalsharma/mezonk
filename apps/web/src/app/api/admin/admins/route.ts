import type { NextRequest } from "next/server";
import { guarded, ok } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { listAdmins } from "@/server/admin";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return guarded(async () => {
    const a = await requireCap(req, "audit:read");
    if (a.res) return a.res;
    return ok({ admins: await listAdmins() }, { maxAge: 0 });
  });
}
