import { fail, guarded, idSchema, ok } from "@/lib/api/http";
import { bookFor } from "@/server/orderbook";

export const dynamic = "force-dynamic";

/** Aggregated YES book (escrowed + open signed orders). `mid` is indicative; only fills are trades. */
export function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const id = idSchema.safeParse((await params).id);
    if (!id.success) return fail(400, "bad_request", "Market id must be a positive integer");
    return ok(await bookFor(id.data), { maxAge: 2 });
  });
}
