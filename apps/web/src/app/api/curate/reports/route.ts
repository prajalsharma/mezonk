import type { NextRequest } from "next/server";
import { guarded, ok } from "@/lib/api/http";
import { requireCap } from "@/lib/api/session";
import { openReports } from "@/server/comments";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  return guarded(async () => {
    const a = await requireCap(req, "comment:moderate");
    if (a.res) return a.res;
    return ok({ reports: await openReports() }, { maxAge: 0 });
  });
}
