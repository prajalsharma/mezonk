import type { NextRequest } from "next/server";
import { z } from "zod";
import { fail, guarded, ok, rateLimit } from "@/lib/api/http";
import { unauthorized, viewer } from "@/lib/api/session";
import { createProject, GovernanceError, listProjects } from "@/server/governance";

export const dynamic = "force-dynamic";
const body = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().trim().min(2).max(80),
  website: z.string().url().max(200).refine((u) => u.startsWith("https://")).optional(),
  description: z.string().trim().max(600).optional(),
  proofUrl: z.string().url().max(400).refine((u) => u.startsWith("https://")).optional(),
});

export function GET() {
  return guarded(async () => ok({ projects: await listProjects() }, { maxAge: 30 }));
}

/** Any signed-in wallet may register a project and claim to represent it; a curator verifies. */
export function POST(req: NextRequest) {
  return guarded(async () => {
    const v = await viewer(req);
    if (!v) return unauthorized();
    if (!rateLimit(req, "project-create", 5, 3600_000)) return fail(429, "rate_limited", "Try again later");
    const p = body.safeParse(await req.json().catch(() => null));
    if (!p.success) return fail(400, "bad_request", "Invalid project", p.error.flatten());
    try {
      await createProject(v.wallet, p.data);
      return ok({ id: p.data.id }, { status: 201, maxAge: 0 });
    } catch (e) {
      if (e instanceof GovernanceError) return fail(e.status, e.code, e.message);
      throw e;
    }
  });
}
