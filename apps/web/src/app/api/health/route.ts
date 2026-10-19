import { deployment, readinessMessage } from "@/lib/chain/config";
import { guarded, ok } from "@/lib/api/http";
import { publicClient } from "@/server/chain";
import { getDb } from "@/server/db/client";
import { getIndexerStatus } from "@/server/queries";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export function GET() {
  return guarded(async () => {
    const t0 = Date.now();
    const rpc = await publicClient
      .getBlockNumber()
      .then((b) => ({ ok: true, blockNumber: b.toString(), latencyMs: Date.now() - t0 }))
      .catch(() => ({ ok: false, blockNumber: null, latencyMs: null }));
    const db = await getDb()
      .then((d) => d.execute(sql`select 1`))
      .then(() => ({ ok: true }))
      .catch(() => ({ ok: false }));
    const indexer = db.ok ? await getIndexerStatus().catch(() => null) : null;
    const healthy = rpc.ok && db.ok && deployment.ready && !!indexer && !indexer.stale;
    return ok(
      {
        ok: healthy,
        chain: {
          chainId: deployment.chainId,
          name: deployment.chain.name,
          localFork: deployment.isLocalFork,
          contract: deployment.marketsAddress,
          musd: deployment.musd,
          ready: deployment.ready,
          reason: deployment.reason,
          message: readinessMessage[deployment.reason],
        },
        rpc,
        db,
        indexer,
      },
      { maxAge: 0, status: healthy ? 200 : 503 },
    );
  });
}
