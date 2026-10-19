import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, idSchema, ok, parseQuery } from "@/lib/api/http";
import { getEvents } from "@/server/queries";

export const dynamic = "force-dynamic";
const schema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  before: z.coerce.number().int().positive().optional(),
});

export function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const id = idSchema.safeParse((await params).id);
    const q = parseQuery(req, schema);
    if (!id.success || !q.success) return fail(400, "bad_request", "Invalid parameters");
    return ok({ events: await getEvents({ marketId: id.data, ...q.data }) });
  });
}
