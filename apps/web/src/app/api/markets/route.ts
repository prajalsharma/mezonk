import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok, pageSchema, parseQuery } from "@/lib/api/http";
import { CATEGORIES } from "@/lib/market/metadata";
import { listMarkets } from "@/server/queries";

export const dynamic = "force-dynamic";

const schema = z.object({
  q: z.string().trim().max(120).optional(),
  category: z.enum(CATEGORIES).optional(),
  status: z.enum(["seeding", "open", "closing", "resolving", "resolved", "all"]).default("all"),
  sort: z.enum(["trending", "volume", "liquidity", "thin", "newest", "closing", "movement"]).default("newest"),
  minLiquidity: z.coerce.number().min(0).max(1e12).optional(),
  closesWithinHours: z.coerce.number().int().min(1).max(24 * 365).optional(),
  creator: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  ...pageSchema,
});

export function GET(req: NextRequest) {
  return guarded(async () => {
    const q = parseQuery(req, schema);
    if (!q.success) return fail(400, "bad_request", "Invalid query parameters", q.error.flatten());
    const { minLiquidity, ...rest } = q.data;
    const res = await listMarkets({
      ...rest,
      minLiquidity: minLiquidity ? BigInt(Math.floor(minLiquidity)) * 10n ** 18n : undefined,
    });
    return ok({ ...res, limit: q.data.limit, offset: q.data.offset });
  });
}
