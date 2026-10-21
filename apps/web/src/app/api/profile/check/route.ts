import type { NextRequest } from "next/server";
import { fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { usernameProblem } from "@/lib/profile/username";
import { viewer } from "@/lib/api/session";
import { usernameAvailable } from "@/server/profiles";

export const dynamic = "force-dynamic";

/** Live availability check for the onboarding form. The unique index is still the real guarantee. */
export function GET(req: NextRequest) {
  return guarded(async () => {
    if (!rateLimit(req, "username-check", 60, 60_000)) return fail(429, "rate_limited", "Too many requests");
    const u = req.nextUrl.searchParams.get("username") ?? "";
    const problem = usernameProblem(u);
    if (problem) return ok({ available: false, problem }, { maxAge: 0 });
    const v = await viewer(req);
    const available = await usernameAvailable(u, v?.wallet);
    return ok({ available, problem: available ? null : "That username is taken" }, { maxAge: 0 });
  });
}
