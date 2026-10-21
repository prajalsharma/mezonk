import type { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { deployment } from "@/lib/chain/config";
import { fail, guarded, ok } from "@/lib/api/http";
import { viewer } from "@/lib/api/session";
import { hasCap } from "@/server/roles";
import { approvalDomain, approvalTypes } from "@/lib/governance/approval";
import { getDb, schema } from "@/server/db/client";
import { buildApproval, GovernanceError } from "@/server/governance";

export const dynamic = "force-dynamic";

/** The exact EIP-712 payload a curator signs for this proposal (deterministic; curators only). */
export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!hasCap(v, "market:review")) return fail(403, "forbidden", "Curators only");
    const { id } = await params;
    if (!z.string().uuid().safeParse(id).success) return fail(400, "bad_request", "Invalid proposal id");
    if (!deployment.marketsAddress) return fail(503, "no_deployment", "No market contract configured");
    const db = await getDb();
    const [p] = await db.select().from(schema.marketProposals).where(eq(schema.marketProposals.id, id));
    if (!p) return fail(404, "not_found", "No such proposal");
    try {
      const approval = await buildApproval(p);
      return ok({ domain: approvalDomain(deployment.chainId, deployment.factoryAddress!), types: approvalTypes, primaryType: "MarketApproval", approval }, { maxAge: 0 });
    } catch (e) {
      if (e instanceof GovernanceError) return fail(e.status, e.code, e.message);
      throw e;
    }
  });
}
