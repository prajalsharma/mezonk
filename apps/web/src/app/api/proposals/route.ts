import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok, pageSchema, parseQuery, rateLimit } from "@/lib/api/http";
import { unauthorized, viewer } from "@/lib/api/session";
import { PROPOSAL_STATUS } from "@/lib/governance/proposal";
import { createProposal, GovernanceError, listProposals } from "@/server/governance";

export const dynamic = "force-dynamic";
const q = z.object({
  status: z.string().optional(),
  mine: z.coerce.boolean().optional(),
  queue: z.coerce.boolean().optional(),
  /** Approved proposals this signed-in wallet may publish. */
  publish: z.coerce.boolean().optional(),
  author: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ...pageSchema,
});

/** Public: community suggestions and their status. Curators: the review queue. Authors: their own, including drafts. */
export function GET(req: NextRequest) {
  return guarded(async () => {
    const p = parseQuery(req, q);
    if (!p.success) return fail(400, "bad_request", "Invalid query", p.error.flatten());
    const v = await viewer(req);
    const statuses = p.data.status?.split(",").filter((s): s is (typeof PROPOSAL_STATUS)[number] => (PROPOSAL_STATUS as readonly string[]).includes(s));
    if (p.data.queue) {
      if (!v?.curator) return fail(403, "forbidden", "Curators only");
      return ok(await listProposals({ status: statuses?.length ? statuses : ["submitted", "under_review", "changes_requested", "approved", "scheduled"], viewer: v, limit: p.data.limit, offset: p.data.offset }), { maxAge: 0 });
    }
    if (p.data.mine) {
      if (!v) return unauthorized();
      return ok(await listProposals({ status: statuses, author: v.wallet, viewer: v, limit: p.data.limit, offset: p.data.offset }), { maxAge: 0 });
    }
    if (p.data.publish) {
      if (!v) return unauthorized();
      return ok(await listProposals({ status: statuses?.length ? statuses : ["approved", "scheduled"], publisher: v.wallet, viewer: v, limit: p.data.limit, offset: p.data.offset }), { maxAge: 0 });
    }
    return ok(await listProposals({ status: statuses, author: p.data.author, viewer: v, publicOnly: true, limit: p.data.limit, offset: p.data.offset }), { maxAge: 10 });
  });
}

export function POST(req: NextRequest) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!v) return unauthorized();
    if (!rateLimit(req, "proposal-create", 10, 3600_000)) return fail(429, "rate_limited", "Proposal limit reached. Try again later.");
    try {
      const row = await createProposal(v.wallet, await req.json());
      return ok({ id: row.id, status: row.status }, { status: 201, maxAge: 0 });
    } catch (e) {
      if (e instanceof GovernanceError) return fail(e.status, e.code, e.message);
      if (e instanceof z.ZodError) return fail(400, "invalid_proposal", "The proposal is incomplete or invalid", e.flatten());
      throw e;
    }
  });
}
