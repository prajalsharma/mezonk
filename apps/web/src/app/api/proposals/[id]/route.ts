import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok } from "@/lib/api/http";
import { unauthorized, viewer } from "@/lib/api/session";
import { getProposal, GovernanceError, updateProposal } from "@/server/governance";

export const dynamic = "force-dynamic";
const idSchema = z.string().uuid();

export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Invalid proposal id");
    const r = await getProposal(id.data, await viewer(req));
    if (!r) return fail(404, "not_found", "No such proposal");
    return ok(r, { maxAge: 0 });
  });
}

export function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!v) return unauthorized();
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Invalid proposal id");
    try {
      const row = await updateProposal(id.data, v.wallet, await req.json());
      return ok({ id: row.id, status: row.status, version: row.version }, { maxAge: 0 });
    } catch (e) {
      if (e instanceof GovernanceError) return fail(e.status, e.code, e.message);
      if (e instanceof z.ZodError) return fail(400, "invalid_proposal", "The proposal is incomplete or invalid", e.flatten());
      throw e;
    }
  });
}
