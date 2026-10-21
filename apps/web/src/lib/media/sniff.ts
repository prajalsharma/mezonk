/**
 * Identifies an image by its leading bytes, never by the declared Content-Type or filename.
 * Only raster formats that sharp decodes safely are accepted. SVG (scriptable), HTML, PDF, and
 * everything else are rejected.
 */
export type ImageType = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_DIMENSION = 8000;

export function sniffImage(buf: Uint8Array): ImageType | null {
  const b = buf;
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61) return "image/gif";
  return null;
}

export type MediaKind = "avatar" | "cover" | "context";
export const MEDIA_KINDS: readonly MediaKind[] = ["avatar", "cover", "context"];
