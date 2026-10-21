import type { NextRequest } from "next/server";
import { fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { profileInputSchema } from "@/lib/profile/username";
import { requireCap, unauthorized, viewer } from "@/lib/api/session";
import { myProfile, upsertProfile } from "@/server/profiles";
import { domainError } from "@/server/route-errors";

export const dynamic = "force-dynamic";

/** The signed-in wallet's profile (fields are null until it creates one). */
export function GET(req: NextRequest) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!v) return unauthorized();
    return ok({ profile: await myProfile(v.wallet) }, { maxAge: 0 });
  });
}

/** Create or update your own profile. The wallet comes from the session, never from the body. */
export function PUT(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "profile", 20, 60_000)) return fail(429, "rate_limited", "Too many requests");
    const a = await requireCap(req, "profile:update:self");
    if (a.res) return a.res;
    const p = profileInputSchema.safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(422, "invalid_profile", p.error.issues[0]?.message ?? "Invalid profile", p.error.flatten());
    try {
      return ok({ profile: await upsertProfile(a.v.wallet, p.data) }, { maxAge: 0 });
    } catch (e) {
      return domainError(e);
    }
  });
}
