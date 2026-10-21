import type { NextRequest } from "next/server";
import { fail, guarded, ok } from "@/lib/api/http";
import { publicProfile } from "@/server/profiles";

export const dynamic = "force-dynamic";

/** Public profile by username or wallet address. */
export function GET(_req: NextRequest, { params }: { params: Promise<{ handle: string }> }) {
  return guarded(async () => {
    const h = (await params).handle;
    if (!/^(0x[0-9a-fA-F]{40}|[a-zA-Z][a-zA-Z0-9_]{2,19})$/.test(h)) return fail(404, "not_found", "No such profile");
    const p = await publicProfile(h);
    if (!p) return fail(404, "not_found", "No such profile");
    return ok(p, { maxAge: 10 });
  });
}
