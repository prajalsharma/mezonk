import "server-only";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Object storage boundary. Bytes never go in Postgres.
 *  - vercel-blob: when BLOB_READ_WRITE_TOKEN is set (production on Vercel). Public, immutable URLs.
 *  - local: development, or when MEDIA_STORAGE=local. Files under MEDIA_DIR (default .media), served by /api/media/{id}.
 *  - none: production without storage configured. Uploads fail with a clear setup error.
 * Credentials stay server-side; the browser only ever sees resulting public URLs.
 */
export interface StorageProvider {
  name: "vercel-blob" | "local";
  put(key: string, bytes: Buffer, contentType: string): Promise<{ url: string | null }>;
  remove(key: string, url: string): Promise<void>;
}

const mediaDir = () => path.resolve(process.cwd(), process.env.MEDIA_DIR || ".media");

const local: StorageProvider = {
  name: "local",
  async put(key, bytes) {
    const file = path.join(mediaDir(), key);
    if (!file.startsWith(mediaDir() + path.sep)) throw new Error("bad key");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    return { url: null }; // caller uses /api/media/{id}
  },
  async remove(key) {
    await unlink(path.join(mediaDir(), key)).catch(() => undefined);
  },
};

export async function readLocal(key: string): Promise<Buffer | null> {
  const file = path.join(mediaDir(), key);
  if (!file.startsWith(mediaDir() + path.sep)) return null;
  return readFile(file).catch(() => null);
}

const blob: StorageProvider = {
  name: "vercel-blob",
  async put(key, bytes, contentType) {
    const { put } = await import("@vercel/blob");
    const r = await put(key, bytes, { access: "public", contentType, addRandomSuffix: false, token: process.env.BLOB_READ_WRITE_TOKEN });
    return { url: r.url };
  },
  async remove(_key, url) {
    const { del } = await import("@vercel/blob");
    await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN }).catch(() => undefined);
  },
};

export function storageProvider(): StorageProvider | null {
  if (process.env.BLOB_READ_WRITE_TOKEN) return blob;
  if (process.env.MEDIA_STORAGE === "local" || process.env.NODE_ENV !== "production") return local;
  return null;
}
