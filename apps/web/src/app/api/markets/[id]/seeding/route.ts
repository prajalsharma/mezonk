import { fail, guarded, idSchema, ok } from "@/lib/api/http";
import { seedingStatus } from "@/server/orderbook";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

/** Graduation check and policy, read directly from the contract (the same check `graduate` applies). */
export function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Market id must be a positive integer");
    try {
      return ok(await seedingStatus(id.data), { maxAge: 2 });
    } catch (e) {
      return domainError(e);
    }
  });
}
