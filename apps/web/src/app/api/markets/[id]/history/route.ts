import { fail, guarded, idSchema, ok } from "@/lib/api/http";
import { getHistory } from "@/server/queries";

export const dynamic = "force-dynamic";

/** Price points from indexed Trade events (pool state after each trade). No interpolation. */
export function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Market id must be a positive integer");
    const h = await getHistory(id.data);
    if (!h) return fail(404, "not_found", "No indexed market with this id");
    return ok({ points: h });
  });
}
