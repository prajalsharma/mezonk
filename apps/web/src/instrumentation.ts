/**
 * Embedded indexer for local development (INDEXER_MODE=embedded). PGlite is single-process,
 * so locally the indexer must live inside the Next.js server. In production use the cron route
 * or the standalone `pnpm indexer` worker against PostgreSQL.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.INDEXER_MODE !== "embedded") return;
  const { runIndexerTick } = await import("./server/indexer/indexer");
  const interval = Number(process.env.INDEXER_INTERVAL_MS ?? 4000);
  const loop = async () => {
    const r = await runIndexerTick().catch((e) => ({ ok: false, error: String(e) }));
    if (!r.ok && "error" in r && r.error !== "no-deployment") console.warn("[indexer]", r.error);
    setTimeout(loop, interval);
  };
  setTimeout(loop, 1500);
  console.log(`[indexer] embedded mode, every ${interval}ms`);
}
