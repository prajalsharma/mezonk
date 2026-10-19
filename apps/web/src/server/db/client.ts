import "server-only";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import * as schema from "./schema";

/**
 * DATABASE_URL set → PostgreSQL (production, Vercel/Neon/Supabase).
 * Unset → embedded PGlite at apps/web/.pglite (local development, single process).
 * `openDb({ memory: true })` gives an isolated in-memory PGlite for tests.
 */
export type Db = ReturnType<typeof drizzlePg<typeof schema>>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

export async function openDb(opts: { url?: string; dir?: string; memory?: boolean } = {}): Promise<Db> {
  if (opts.url) {
    const postgres = (await import("postgres")).default;
    const client = postgres(opts.url, { max: 5, prepare: false });
    const db = drizzlePg(client, { schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS });
    return db;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = opts.memory ? new PGlite() : new PGlite(opts.dir ?? path.join(process.cwd(), ".pglite"));
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  // Both drivers expose the same query-builder surface for everything this app uses.
  return db as unknown as Db;
}

const globalForDb = globalThis as unknown as { __mezonkDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.__mezonkDb ??= openDb({ url: process.env.DATABASE_URL, dir: process.env.PGLITE_DIR }).catch((e) => {
    globalForDb.__mezonkDb = undefined;
    throw e;
  });
  return globalForDb.__mezonkDb;
}

export { schema };
