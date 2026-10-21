import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { capabilitiesOf, rolesOf, type Capability, type PlatformRole } from "@/lib/auth/capabilities";
import { deployment } from "@/lib/chain/config";
import { exchangeAbi, factoryAbi } from "@/lib/contracts/abi";
import { publicClient } from "@/server/chain";
import { getDb, schema } from "@/server/db/client";

export interface Roles {
  wallet: string;
  /** Protocol roles, read from the MezonkMarkets contract. */
  owner: boolean;
  curator: boolean;
  creator: boolean;
  resolver: boolean;
  arbitrator: boolean;
  /** Platform roles and status, read from the database. */
  admin: boolean;
  suspended: boolean;
  /** Projects this wallet is a verified representative of (backend-only, disclosure role). */
  verifiedProjects: string[];
  platformRoles: PlatformRole[];
  capabilities: Capability[];
}

type ChainRoles = Pick<Roles, "owner" | "curator" | "creator" | "resolver" | "arbitrator">;
const chainCache = new Map<string, { at: number; roles: ChainRoles }>();
const TTL = 30_000;

async function chainRoles(w: string): Promise<ChainRoles> {
  const hit = chainCache.get(w);
  if (hit && Date.now() - hit.at < TTL) return hit.roles;
  let owner = false, curator = false, creator = false, resolver = false, arbitrator = false;
  const ex = deployment.marketsAddress;
  const fac = deployment.factoryAddress;
  if (ex && fac) {
    const f = { address: fac, abi: factoryAbi } as const;
    const [o, cu, cr, re, cfg] = await Promise.all([
      publicClient.readContract({ address: ex, abi: exchangeAbi, functionName: "owner" }),
      publicClient.readContract({ ...f, functionName: "isCurator", args: [w as `0x${string}`] }),
      publicClient.readContract({ ...f, functionName: "isCreator", args: [w as `0x${string}`] }),
      publicClient.readContract({ ...f, functionName: "isResolver", args: [w as `0x${string}`] }),
      publicClient.readContract({ ...f, functionName: "config" }),
    ]).catch(() => [undefined, false, false, false, undefined] as const);
    owner = typeof o === "string" && o.toLowerCase() === w;
    curator = Boolean(cu);
    creator = Boolean(cr);
    resolver = Boolean(re);
    arbitrator = !!cfg && typeof cfg === "object" && "arbitrator" in cfg && String(cfg.arbitrator).toLowerCase() === w;
  }
  const roles = { owner, curator, creator, resolver, arbitrator };
  chainCache.set(w, { at: Date.now(), roles });
  return roles;
}

/**
 * Protocol roles from the contract (cached 30 s, cleared on any role change made through the app);
 * platform roles and suspension from the database, read fresh on every call so revocation is immediate.
 * A suspended wallet holds no capabilities, whatever the chain says.
 */
export async function getRoles(wallet: string): Promise<Roles> {
  const w = wallet.toLowerCase();
  const chain = await chainRoles(w);
  const db = await getDb();
  const [reps, adminRows, acct] = await Promise.all([
    db
      .select({ projectId: schema.projectRepresentatives.projectId })
      .from(schema.projectRepresentatives)
      .where(and(eq(schema.projectRepresentatives.wallet, w), eq(schema.projectRepresentatives.status, "verified"))),
    db
      .select({ id: schema.roleAssignments.id })
      .from(schema.roleAssignments)
      .where(and(eq(schema.roleAssignments.wallet, w), eq(schema.roleAssignments.role, "ADMINISTRATOR"), isNull(schema.roleAssignments.revokedAt))),
    db.select().from(schema.accounts).where(eq(schema.accounts.wallet, w)),
  ]);
  const suspended = acct[0]?.status === "suspended";
  const flags = { creator: chain.creator, curator: chain.curator, admin: adminRows.length > 0, suspended };
  return {
    wallet: w,
    ...chain,
    // Protocol flags are reported as-is (they are facts about the chain) but grant nothing while suspended.
    admin: flags.admin && !suspended,
    suspended,
    verifiedProjects: suspended ? [] : reps.map((r) => r.projectId),
    platformRoles: rolesOf(flags),
    capabilities: [...capabilitiesOf(flags)],
  };
}

export const hasCap = (r: Roles | null | undefined, c: Capability) => !!r && r.capabilities.includes(c);

export const invalidateRoles = (wallet?: string) => (wallet ? chainCache.delete(wallet.toLowerCase()) : chainCache.clear());
