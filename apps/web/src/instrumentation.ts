/**
 * Embedded indexer for local development (INDEXER_MODE=embedded). PGlite is single-process,
 * so locally the indexer must live inside the Next.js server. In production use the cron route
 * or the standalone `pnpm indexer` worker against PostgreSQL.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.INDEXER_MODE === "embedded") {
    await import("./instrumentation-node");
  }
}
