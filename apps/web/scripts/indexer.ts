/**
 * Standalone indexer worker for production (PostgreSQL). Run next to the web app:
 *   DATABASE_URL=... NEXT_PUBLIC_MARKETS_ADDRESS=... pnpm indexer
 * Refuses to run against embedded PGlite (single-process; use INDEXER_MODE=embedded instead).
 */
import { runIndexerTick } from "../src/server/indexer/indexer";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required. For local PGlite, use INDEXER_MODE=embedded inside `pnpm dev`.");
  process.exit(1);
}
const interval = Number(process.env.INDEXER_INTERVAL_MS ?? 4000);
let stopping = false;
process.on("SIGINT", () => (stopping = true));
process.on("SIGTERM", () => (stopping = true));

(async () => {
  console.log(`[indexer] worker started, every ${interval}ms`);
  while (!stopping) {
    const r = await runIndexerTick().catch((e) => ({ ok: false, error: String(e) }) as const);
    if (!r.ok) console.warn("[indexer]", "error" in r ? r.error : r);
    else if ("eventsInserted" in r && r.eventsInserted) console.log(`[indexer] +${r.eventsInserted} events, ${r.marketsRebuilt} markets`);
    await new Promise((s) => setTimeout(s, interval));
  }
  process.exit(0);
})();
