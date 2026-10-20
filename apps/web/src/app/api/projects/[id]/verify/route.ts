import type { NextRequest } from "next/server";
import { z } from "zod";
import { addressSchema, fail, guarded, ok } from "@/lib/api/http";
import { unauthorized, viewer } from "@/lib/api/session";
import { GovernanceError, reviewProject } from "@/server/governance";
import { invalidateRoles } from "@/server/roles";

export const dynamic = "force-dynamic";
const body = z.object({ wallet: addressSchema, verdict: z.enum(["verified", "revoked"]), reason: z.string().trim().max(600).default("") });

export function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!v) return unauthorized();
    const { id } = await params;
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(400, "bad_request", "Invalid request");
    try {
      await reviewProject(v, id, p.data.wallet, p.data.verdict, p.data.reason);
      invalidateRoles(p.data.wallet);
      return ok({ ok: true }, { maxAge: 0 });
    } catch (e) {
      if (e instanceof GovernanceError) return fail(e.status, e.code, e.message);
      throw e;
    }
  });
}
