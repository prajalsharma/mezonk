import "server-only";
import { deployment } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { publicClient } from "@/server/chain";
import { getDb, schema } from "@/server/db/client";
import { and, eq } from "drizzle-orm";

export interface Roles {
  wallet: string;
  owner: boolean;
  curator: boolean;
  creator: boolean;
  resolver: boolean;
  arbitrator: boolean;
  /** Projects this wallet is a verified representative of (backend-only, disclosure role). */
  verifiedProjects: string[];
}

const cache = new Map<string, { at: number; roles: Roles }>();
const TTL = 30_000;

/** Protocol roles are read from the contract; project roles from the review store. */
export async function getRoles(wallet: string): Promise<Roles> {
  const w = wallet.toLowerCase();
  const hit = cache.get(w);
  if (hit && Date.now() - hit.at < TTL) return hit.roles;

  let owner = false, curator = false, creator = false, resolver = false, arbitrator = false;
  const addr = deployment.marketsAddress;
  if (addr) {
    const base = { address: addr, abi: mezonkMarketsAbi } as const;
    const [o, cu, cr, re, cfg] = await Promise.all([
      publicClient.readContract({ ...base, functionName: "owner" }),
      publicClient.readContract({ ...base, functionName: "isCurator", args: [w as `0x${string}`] }),
      publicClient.readContract({ ...base, functionName: "isCreator", args: [w as `0x${string}`] }),
      publicClient.readContract({ ...base, functionName: "isResolver", args: [w as `0x${string}`] }),
      publicClient.readContract({ ...base, functionName: "config" }),
    ]).catch(() => [undefined, false, false, false, undefined] as const);
    owner = typeof o === "string" && o.toLowerCase() === w;
    curator = Boolean(cu);
    creator = Boolean(cr);
    resolver = Boolean(re);
    arbitrator = Array.isArray(cfg) && String(cfg[10]).toLowerCase() === w;
  }
  const db = await getDb();
  const reps = await db
    .select({ projectId: schema.projectRepresentatives.projectId })
    .from(schema.projectRepresentatives)
    .where(and(eq(schema.projectRepresentatives.wallet, w), eq(schema.projectRepresentatives.status, "verified")));
  const roles: Roles = { wallet: w, owner, curator, creator, resolver, arbitrator, verifiedProjects: reps.map((r) => r.projectId) };
  cache.set(w, { at: Date.now(), roles });
  return roles;
}

export const invalidateRoles = (wallet?: string) => (wallet ? cache.delete(wallet.toLowerCase()) : cache.clear());
