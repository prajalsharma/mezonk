import { addressSchema, fail, guarded, ok } from "@/lib/api/http";
import { getPortfolio } from "@/server/queries";

export const dynamic = "force-dynamic";

/** Indexed positions. Claimable amounts must be confirmed with contract reads before claiming. */
export function GET(_: Request, { params }: { params: Promise<{ address: string }> }) {
  return guarded(async () => {
    const a = addressSchema.safeParse((await params).address);
    if (!a.success) return fail(400, "bad_request", "Invalid address");
    return ok(await getPortfolio(a.data));
  });
}
