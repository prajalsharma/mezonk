import { runIndexerTick } from "./server/indexer/indexer";

const interval = Number(process.env.INDEXER_INTERVAL_MS ?? 4000);
const g = globalThis as unknown as { __mezonkIndexerLoop?: boolean };

if (!g.__mezonkIndexerLoop) {
  g.__mezonkIndexerLoop = true;
  const loop = async () => {
    const r = await runIndexerTick().catch((e) => ({ ok: false, error: String(e) }));
    if (!r.ok && "error" in r && r.error !== "no-deployment") console.warn("[indexer]", r.error);
    setTimeout(loop, interval);
  };
  setTimeout(loop, 1500);
  console.log(`[indexer] embedded mode, every ${interval}ms`);
}
