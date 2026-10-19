import { fail, guarded, ok } from "@/lib/api/http";
import { evidenceHash, parseEvidence } from "@/lib/market/evidence";
import { getEvidenceDocument } from "@/server/queries";

export const dynamic = "force-dynamic";

/** Returns the stored document and whether keccak256(raw) matches the requested hash. */
export function GET(_: Request, { params }: { params: Promise<{ hash: string }> }) {
  return guarded(async () => {
    const { hash } = await params;
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return fail(400, "bad_request", "Expected a 32-byte hex hash");
    const d = await getEvidenceDocument(hash);
    if (!d) return fail(404, "not_found", "No document stored for this hash");
    return ok(
      { hash: d.hash, raw: d.raw, doc: parseEvidence(d.raw), verified: evidenceHash(d.raw).toLowerCase() === d.hash },
      { maxAge: 3600 },
    );
  });
}
