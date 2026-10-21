import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import sharp from "sharp";
import { MAX_DIMENSION, MAX_UPLOAD_BYTES, sniffImage, type MediaKind } from "@/lib/media/sniff";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { storageProvider } from "@/server/storage";

const { media } = schema;

export class MediaError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
const deny = (s: number, c: string, m: string) => new MediaError(s, c, m);

const DAILY_QUOTA = 40;
const SIZES: Record<MediaKind, { w: number; h: number; fit: "cover" | "inside" }> = {
  avatar: { w: 512, h: 512, fit: "cover" },
  cover: { w: 1920, h: 1080, fit: "inside" },
  context: { w: 1920, h: 1920, fit: "inside" },
};

/**
 * Validates and stores one image. The upload is decoded and re-encoded to WebP, which drops metadata
 * (EXIF/GPS), normalises orientation and destroys polyglot payloads; nothing the user sent is stored as-is.
 */
export async function uploadImage(owner: string, kind: MediaKind, input: Buffer) {
  const provider = storageProvider();
  if (!provider) throw deny(503, "storage_not_configured", "Image storage isn't configured on this deployment (set BLOB_READ_WRITE_TOKEN).");
  if (input.length === 0) throw deny(400, "empty", "The file is empty");
  if (input.length > MAX_UPLOAD_BYTES) throw deny(413, "too_large", "Images must be 5 MB or smaller");
  if (!sniffImage(input)) throw deny(415, "unsupported", "Use a PNG, JPEG, WebP or GIF image");
  const w = owner.toLowerCase();
  const db = await getDb();
  const [q] = await db.select({ n: sql<number>`count(*)::int` }).from(media).where(and(eq(media.owner, w), gt(media.createdAt, new Date(Date.now() - 86_400_000))));
  if ((q?.n ?? 0) >= DAILY_QUOTA) throw deny(429, "quota", "Daily upload limit reached. Try again tomorrow.");

  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION, failOn: "error" }).metadata();
  } catch {
    throw deny(415, "corrupt", "This image couldn't be read");
  }
  if (!meta.width || !meta.height || meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) throw deny(422, "dimensions", `Images must be at most ${MAX_DIMENSION}×${MAX_DIMENSION} pixels`);
  const size = SIZES[kind];
  const out = await sharp(input, { limitInputPixels: MAX_DIMENSION * MAX_DIMENSION, animated: false })
    .rotate()
    .resize({ width: size.w, height: size.h, fit: size.fit, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const id = randomUUID();
  const key = `${kind}/${id}.webp`;
  const { url } = await provider.put(key, out.data, "image/webp");
  const [row] = await db
    .insert(media)
    .values({
      id,
      owner: w,
      kind,
      status: "pending",
      provider: provider.name,
      storageKey: key,
      url: url ?? `/api/media/${id}`,
      mime: "image/webp",
      width: out.info.width,
      height: out.info.height,
      bytes: out.data.length,
      sha256: createHash("sha256").update(out.data).digest("hex"),
    })
    .returning();
  return { id: row!.id, url: row!.url, width: row!.width, height: row!.height, kind };
}

export async function getMedia(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(media).where(eq(media.id, id));
  return row ?? null;
}

/** Moderator removal: hidden immediately everywhere, bytes deleted from storage, audited. */
export async function removeMedia(actor: string, id: string, reason: string) {
  const row = await getMedia(id);
  if (!row) throw deny(404, "not_found", "No such image");
  const db = await getDb();
  await db.update(media).set({ status: "removed" }).where(eq(media.id, id));
  await storageProvider()?.remove(row.storageKey, row.url);
  await audit(actor, "media.remove", "media", id, { owner: row.owner, reason });
}

/** Deletes uploads never attached to anything within 24 hours. Called from the cron route. */
export async function cleanupPendingMedia() {
  const db = await getDb();
  const stale = await db.select().from(media).where(and(eq(media.status, "pending"), lt(media.createdAt, new Date(Date.now() - 86_400_000)))).limit(200);
  for (const m of stale) {
    await storageProvider()?.remove(m.storageKey, m.url);
    await db.delete(media).where(eq(media.id, m.id));
  }
  return stale.length;
}
