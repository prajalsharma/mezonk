import type { NextRequest } from "next/server";
import { z } from "zod";
import { addressSchema, fail, guarded, ok, parseQuery } from "@/lib/api/http";
import { getEvents } from "@/server/queries";

export const dynamic = "force-dynamic";
const schema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(40),
  before: z.coerce.number().int().positive().optional(),
});

export function GET(req: NextRequest, { params }: { params: Promise<{ address: string }> }) {
  return guarded(async () => {
    const a = addressSchema.safeParse((await params).address);
    const q = parseQuery(req, schema);
    if (!a.success || !q.success) return fail(400, "bad_request", "Invalid parameters");
    return ok({ events: await getEvents({ actor: a.data, ...q.data }) });
  });
}
