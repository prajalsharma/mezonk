import { fail, guarded, idSchema, ok } from "@/lib/api/http";
import { getMarket } from "@/server/queries";

export const dynamic = "force-dynamic";

export function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Market id must be a positive integer");
    const m = await getMarket(id.data);
    if (!m) return fail(404, "not_found", "No indexed market with this id");
    return ok({ market: m.row, summary: m.summary });
  });
}
