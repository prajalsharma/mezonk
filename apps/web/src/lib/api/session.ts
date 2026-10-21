import "server-only";
import type { NextRequest } from "next/server";
import type { Capability } from "@/lib/auth/capabilities";
import { fail } from "@/lib/api/http";
import { walletFromRequest } from "@/server/auth";
import { getRoles, hasCap, type Roles } from "@/server/roles";

/**
 * Resolves the signed-in wallet and its roles, or null. A suspended account is treated as signed out
 * for every protected action (its sessions are also revoked when it is suspended).
 */
export async function viewer(req: NextRequest): Promise<Roles | null> {
  const w = await walletFromRequest(req);
  if (!w) return null;
  const r = await getRoles(w);
  return r.suspended ? null : r;
}

export const unauthorized = () => fail(401, "unauthorized", "Sign in with your wallet first");
export const forbidden = (msg = "You don't have permission to do this") => fail(403, "forbidden", msg);

/** viewer + capability check in one step. Returns either the roles or the error response to send. */
export async function requireCap(req: NextRequest, cap: Capability): Promise<{ v: Roles; res?: never } | { v?: never; res: Response }> {
  const v = await viewer(req);
  if (!v) return { res: unauthorized() };
  if (!hasCap(v, cap)) return { res: forbidden() };
  return { v };
}
