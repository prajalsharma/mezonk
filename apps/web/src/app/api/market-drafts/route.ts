import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { addressSchema, fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { metadataHash, metadataSchema, reviewMetadata, serializeMetadata } from "@/lib/market/metadata";
import { getDb, schema } from "@/server/db/client";
import { listMarkets } from "@/server/queries";

export const dynamic = "force-dynamic";

const body = z.object({
  metadata: metadataSchema,
  closeTime: z.string().datetime(),
  author: addressSchema.optional(),
});

/**
 * Validates a market draft, checks for similar existing markets and returns the exact bytes
 * and hash that will be committed on-chain. Drafts are off-chain and never shown as markets.
 */
export function POST(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "drafts", 30, 60_000)) return fail(429, "rate_limited", "Too many requests. Try again shortly.");
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return fail(400, "invalid_draft", "The draft is incomplete or invalid", parsed.error.flatten());
    const { metadata, closeTime, author } = parsed.data;
    const issues = reviewMetadata(metadata, new Date(closeTime));

    // Duplicate check: open markets sharing most significant words with this question.
    const words = metadata.question
      .toLowerCase()
      .replace(/[^a-z0-9$ ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const pool = (await listMarkets({ status: "open", limit: 500, offset: 0 })).items;
    const similar = pool
      .map((m) => {
        const q = m.question.toLowerCase();
        const hits = words.filter((w) => q.includes(w)).length;
        return { id: m.id, question: m.question, score: words.length ? hits / words.length : 0 };
      })
      .filter((m) => m.score >= 0.6)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const raw = serializeMetadata(metadata);
    const id = randomUUID();
    const db = await getDb();
    await db.insert(schema.marketDrafts).values({ id, metadata, author: author ?? null });
    return ok({ id, raw, hash: metadataHash(raw), bytes: new TextEncoder().encode(raw).length, issues, similar });
  });
}
