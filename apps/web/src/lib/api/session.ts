import "server-only";
import type { NextRequest } from "next/server";
import { fail } from "@/lib/api/http";
import { walletFromRequest } from "@/server/auth";
import { getRoles, type Roles } from "@/server/roles";

/** Resolves the signed-in wallet and its chain roles, or null. */
export async function viewer(req: NextRequest): Promise<Roles | null> {
  const w = walletFromRequest(req);
  return w ? getRoles(w) : null;
}

export const unauthorized = () => fail(401, "unauthorized", "Sign in with your wallet first");
