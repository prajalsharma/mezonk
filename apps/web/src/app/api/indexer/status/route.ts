import { deployment } from "@/lib/chain/config";
import { guarded, ok } from "@/lib/api/http";
import { getIndexerStatus } from "@/server/queries";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(async () =>
    ok({ chainId: deployment.chainId, contract: deployment.marketsAddress, status: await getIndexerStatus() }, { maxAge: 0 }),
  );
}
