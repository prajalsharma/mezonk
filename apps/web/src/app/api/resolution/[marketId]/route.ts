import { fail, guarded, idSchema, ok } from "@/lib/api/http";
import { getResolution } from "@/server/queries";

export const dynamic = "force-dynamic";

export function GET(_: Request, { params }: { params: Promise<{ marketId: string }> }) {
  return guarded(async () => {
    const id = idSchema.safeParse((await params).marketId);
    if (!id.success) return fail(400, "bad_request", "Market id must be a positive integer");
    const r = await getResolution(id.data);
    if (!r) return fail(404, "not_found", "No indexed market with this id");
    return ok(r);
  });
}
