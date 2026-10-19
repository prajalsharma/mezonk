import type { NextRequest } from "next/server";
import { fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { evidenceDocSchema, serializeEvidence } from "@/lib/market/evidence";
import { getMarket, saveEvidenceDocument } from "@/server/queries";

export const dynamic = "force-dynamic";

/**
 * Publish an evidence document before committing its hash on-chain. The server stores the canonical
 * serialization only; it never fetches the linked URLs (no SSRF surface). Storing a document grants
 * nothing: it matters only if an authorized wallet later commits the same hash in a contract call.
 */
export function POST(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "evidence-doc", 20, 60_000)) return fail(429, "rate_limited", "Too many submissions. Try again shortly.");
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > 16_384) return fail(413, "too_large", "Evidence documents are limited to 16 KB");
    const parsed = evidenceDocSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid_evidence", "The evidence document is invalid", parsed.error.flatten());
    if (!(await getMarket(parsed.data.marketId))) return fail(404, "not_found", "No indexed market with this id");
    const raw = serializeEvidence(parsed.data);
    const hash = await saveEvidenceDocument(raw, parsed.data.kind, parsed.data.marketId, parsed.data.author);
    const uri = `${req.nextUrl.origin}/api/evidence-documents/${hash}`;
    return ok({ hash, raw, uri }, { status: 201, maxAge: 0 });
  });
}
