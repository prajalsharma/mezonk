import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { encodeFunctionData, getAddress, isAddress, parseEventLogs, type Address, type Hash } from "viem";
import type { StoredApproval } from "@/lib/governance/approval";
import { deployment } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { audit } from "@/server/audit";
import { revokeAllSessions } from "@/server/auth";
import { publicClient } from "@/server/chain";
import { getDb, schema } from "@/server/db/client";
import { getRoles, invalidateRoles, type Roles } from "@/server/roles";

const { roleAssignments, accounts, sessions, roleOperations, walletReplacements, marketProposals, profiles, auditLog } = schema;

export class AdminError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
const deny = (status: number, code: string, msg: string) => new AdminError(status, code, msg);

export function normalizeWallet(w: string): string {
  if (!isAddress(w, { strict: false })) throw deny(400, "bad_address", "Not a valid EVM address");
  return w.toLowerCase();
}

async function activeAdmins(): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select({ wallet: roleAssignments.wallet }).from(roleAssignments).where(and(eq(roleAssignments.role, "ADMINISTRATOR"), isNull(roleAssignments.revokedAt)));
  const suspended = rows.length
    ? await db.select({ wallet: accounts.wallet }).from(accounts).where(and(inArray(accounts.wallet, rows.map((r) => r.wallet)), eq(accounts.status, "suspended")))
    : [];
  const s = new Set(suspended.map((r) => r.wallet));
  return rows.map((r) => r.wallet).filter((w) => !s.has(w));
}

/**
 * First-administrator bootstrap. Only when ADMIN_BOOTSTRAP_WALLET matches a wallet that has just proven
 * control with a fresh signature AND no administrator has ever been active. After that it does nothing.
 * Missing or malformed config fails closed (no admin).
 */
export async function maybeBootstrapAdmin(wallet: string): Promise<boolean> {
  const cfg = process.env.ADMIN_BOOTSTRAP_WALLET?.trim();
  if (!cfg || !isAddress(cfg, { strict: false }) || cfg.toLowerCase() !== wallet.toLowerCase()) return false;
  const db = await getDb();
  const [any] = await db.select({ n: sql<number>`count(*)::int` }).from(roleAssignments).where(eq(roleAssignments.role, "ADMINISTRATOR"));
  if ((any?.n ?? 0) > 0) return false; // ever granted before → bootstrap is spent, even if later revoked
  await db.insert(roleAssignments).values({ wallet: wallet.toLowerCase(), role: "ADMINISTRATOR", grantedBy: "bootstrap", reason: "ADMIN_BOOTSTRAP_WALLET first sign-in" }).onConflictDoNothing();
  await audit(wallet, "role.grant", "wallet", wallet, { role: "ADMINISTRATOR", via: "bootstrap" });
  return true;
}

export async function grantAdmin(actor: Roles, target: string, reason: string) {
  const t = normalizeWallet(target);
  if (reason.trim().length < 5) throw deny(422, "reason_required", "Give a reason (at least 5 characters)");
  const db = await getDb();
  const [acct] = await db.select().from(accounts).where(eq(accounts.wallet, t));
  if (acct?.status === "suspended") throw deny(409, "suspended", "Restore the account before granting a role");
  const inserted = await db.insert(roleAssignments).values({ wallet: t, role: "ADMINISTRATOR", grantedBy: actor.wallet, reason }).onConflictDoNothing().returning();
  if (!inserted.length) throw deny(409, "already", "This wallet is already an administrator");
  await audit(actor.wallet, "role.grant", "wallet", t, { role: "ADMINISTRATOR", reason });
}

export async function revokeAdmin(actor: Roles, target: string, reason: string) {
  const t = normalizeWallet(target);
  if (t === actor.wallet) throw deny(409, "self", "Ask another administrator to revoke your role");
  if (reason.trim().length < 5) throw deny(422, "reason_required", "Give a reason (at least 5 characters)");
  const admins = await activeAdmins();
  if (admins.includes(t) && admins.length <= 1) throw deny(409, "last_admin", "You can't revoke the last active administrator");
  const db = await getDb();
  const rows = await db
    .update(roleAssignments)
    .set({ revokedAt: new Date(), revokedBy: actor.wallet, revokeReason: reason })
    .where(and(eq(roleAssignments.wallet, t), eq(roleAssignments.role, "ADMINISTRATOR"), isNull(roleAssignments.revokedAt)))
    .returning();
  if (!rows.length) throw deny(404, "not_admin", "This wallet is not an administrator");
  await audit(actor.wallet, "role.revoke", "wallet", t, { role: "ADMINISTRATOR", reason });
}

/** Suspends an account: no capabilities, all sessions revoked immediately. Protocol roles are NOT touched here. */
export async function suspend(actor: Roles, target: string, reason: string, opts: { incidentId?: string } = {}) {
  const t = normalizeWallet(target);
  if (t === actor.wallet) throw deny(409, "self", "You can't suspend yourself");
  if (reason.trim().length < 5) throw deny(422, "reason_required", "Give a reason (at least 5 characters)");
  const admins = await activeAdmins();
  if (admins.includes(t) && admins.length <= 1) throw deny(409, "last_admin", "You can't suspend the last active administrator");
  const db = await getDb();
  await db
    .insert(accounts)
    .values({ wallet: t, status: "suspended", statusReason: reason, statusBy: actor.wallet, statusAt: new Date() })
    .onConflictDoUpdate({ target: accounts.wallet, set: { status: "suspended", statusReason: reason, statusBy: actor.wallet, statusAt: new Date() } });
  const revoked = await revokeAllSessions(t, "suspended");
  invalidateRoles(t);
  await audit(actor.wallet, "account.suspend", "wallet", t, { reason, sessionsRevoked: revoked, incidentId: opts.incidentId });
  return { sessionsRevoked: revoked };
}

export async function restore(actor: Roles, target: string, reason: string) {
  const t = normalizeWallet(target);
  if (reason.trim().length < 5) throw deny(422, "reason_required", "Give a reason (at least 5 characters)");
  const db = await getDb();
  const rows = await db.update(accounts).set({ status: "active", statusReason: reason, statusBy: actor.wallet, statusAt: new Date() }).where(and(eq(accounts.wallet, t), eq(accounts.status, "suspended"))).returning();
  if (!rows.length) throw deny(404, "not_suspended", "This account is not suspended");
  invalidateRoles(t);
  await audit(actor.wallet, "account.restore", "wallet", t, { reason });
}

export async function revokeSessionsOf(actor: Roles, target: string, reason: string) {
  const t = normalizeWallet(target);
  const n = await revokeAllSessions(t, `admin: ${reason}`.slice(0, 200));
  await audit(actor.wallet, "session.revoke_all", "wallet", t, { reason, sessionsRevoked: n });
  return { sessionsRevoked: n };
}

/** Everything an operator needs to judge one wallet. Protocol roles are read live from the contract. */
export async function inspectWallet(target: string) {
  const t = normalizeWallet(target);
  invalidateRoles(t);
  const db = await getDb();
  const [roles, profile, acct, assignments, live, ops, events] = await Promise.all([
    getRoles(t),
    db.select().from(profiles).where(eq(profiles.wallet, t)),
    db.select().from(accounts).where(eq(accounts.wallet, t)),
    db.select().from(roleAssignments).where(eq(roleAssignments.wallet, t)).orderBy(desc(roleAssignments.grantedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.wallet, t), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`)),
    db.select().from(roleOperations).where(eq(roleOperations.target, t)).orderBy(desc(roleOperations.createdAt)).limit(50),
    db.select().from(auditLog).where(and(eq(auditLog.subjectType, "wallet"), eq(auditLog.subjectId, t))).orderBy(desc(auditLog.createdAt)).limit(50),
  ]);
  return {
    wallet: getAddress(t),
    profile: profile[0] ? { username: profile[0].username, displayName: profile[0].displayName } : null,
    status: acct[0]?.status ?? "active",
    statusReason: acct[0]?.statusReason ?? null,
    protocol: { owner: roles.owner, creator: roles.creator, curator: roles.curator, resolver: roles.resolver, arbitrator: roles.arbitrator },
    admin: assignments.some((a) => a.role === "ADMINISTRATOR" && !a.revokedAt),
    assignments: assignments.map((a) => ({ ...a, grantedAt: a.grantedAt.toISOString(), revokedAt: a.revokedAt?.toISOString() ?? null })),
    activeSessions: live[0]?.n ?? 0,
    operations: ops.map(serializeOp),
    history: events.map((e) => ({ actor: e.actor, action: e.action, details: e.details, createdAt: e.createdAt.toISOString() })),
  };
}

export async function listAudit(limit: number, before?: number) {
  const db = await getDb();
  const rows = await db
    .select()
    .from(auditLog)
    .where(before ? sql`${auditLog.id} < ${before}` : undefined)
    .orderBy(desc(auditLog.id))
    .limit(limit);
  return rows.map((r) => ({ id: r.id, actor: r.actor, action: r.action, subjectType: r.subjectType, subjectId: r.subjectId, details: r.details, createdAt: r.createdAt.toISOString() }));
}

export async function listAdmins() {
  const db = await getDb();
  const rows = await db.select().from(roleAssignments).where(and(eq(roleAssignments.role, "ADMINISTRATOR"), isNull(roleAssignments.revokedAt))).orderBy(roleAssignments.grantedAt);
  return rows.map((r) => ({ wallet: getAddress(r.wallet), grantedBy: r.grantedBy, grantedAt: r.grantedAt.toISOString(), reason: r.reason }));
}

// ───────────────────────────── On-chain role operations ─────────────────────────────

type RoleFn = "setCreator" | "setCurator";
type OpRow = typeof roleOperations.$inferSelect;

function serializeOp(o: OpRow) {
  return {
    id: o.id,
    fn: o.fn as RoleFn,
    target: getAddress(o.target),
    grant: o.grant,
    status: o.status,
    txHash: o.txHash,
    error: o.error,
    reason: o.reason,
    requestedBy: o.requestedBy,
    incidentId: o.incidentId,
    confirmedBlock: o.confirmedBlock?.toString() ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    calldata: encodeFunctionData({ abi: mezonkMarketsAbi, functionName: o.fn as RoleFn, args: [getAddress(o.target), o.grant] }),
    contract: deployment.marketsAddress,
  };
}

/**
 * Records a requested protocol role change. It is NOT a change: the contract owner must sign it.
 * The response carries the exact calldata so a Safe owner can propose it in the Safe UI.
 */
export async function createRoleOperation(actor: Roles, fn: RoleFn, target: string, grant: boolean, reason: string, incidentId?: string) {
  if (!deployment.marketsAddress) throw deny(503, "no_deployment", "No market contract is configured");
  const t = normalizeWallet(target);
  if (reason.trim().length < 5) throw deny(422, "reason_required", "Give a reason (at least 5 characters)");
  const db = await getDb();
  const [row] = await db.insert(roleOperations).values({ id: randomUUID(), fn, target: t, grant, requestedBy: actor.wallet, reason, incidentId: incidentId ?? null }).returning();
  await audit(actor.wallet, "role_op.create", "wallet", t, { fn, grant, reason, operationId: row!.id, incidentId });
  const owner = await publicClient.readContract({ address: deployment.marketsAddress, abi: mezonkMarketsAbi, functionName: "owner" }).catch(() => null);
  return { ...serializeOp(row!), owner };
}

export async function attachRoleTx(actor: Roles, opId: string, txHash: Hash) {
  const db = await getDb();
  const [op] = await db.select().from(roleOperations).where(eq(roleOperations.id, opId));
  if (!op) throw deny(404, "not_found", "No such operation");
  if (op.status === "confirmed") throw deny(409, "done", "This operation is already confirmed");
  try {
    const [row] = await db.update(roleOperations).set({ txHash: txHash.toLowerCase(), status: "submitted", error: null, updatedAt: new Date() }).where(eq(roleOperations.id, opId)).returning();
    await audit(actor.wallet, "role_op.submit", "wallet", op.target, { operationId: opId, txHash });
    return reconcileRoleOperation(row!.id);
  } catch (e) {
    if (String(e).includes("role_operations_tx")) throw deny(409, "tx_reused", "That transaction is already attached to another operation");
    throw e;
  }
}

/**
 * Confirms an operation only from chain facts: a successful receipt that contains the matching
 * CreatorUpdated/CuratorUpdated event emitted by the market contract (works for EOA owners and Safes),
 * and a fresh read that the flag now has the requested value. Idempotent; safe to call repeatedly.
 */
export async function reconcileRoleOperation(opId: string) {
  const db = await getDb();
  const [op] = await db.select().from(roleOperations).where(eq(roleOperations.id, opId));
  if (!op) throw deny(404, "not_found", "No such operation");
  if (op.status === "confirmed" || !op.txHash || !deployment.marketsAddress) return serializeOp(op);
  const set = async (patch: Partial<OpRow>) => {
    const [r] = await db.update(roleOperations).set({ ...patch, updatedAt: new Date() }).where(eq(roleOperations.id, opId)).returning();
    return serializeOp(r!);
  };
  const receipt = await publicClient.getTransactionReceipt({ hash: op.txHash as Hash }).catch(() => null);
  if (!receipt) return serializeOp(op); // not mined yet (or unknown hash): stays "submitted"
  if (receipt.status !== "success") return set({ status: "failed", error: "The transaction reverted on-chain. Nothing changed." });
  const eventName = op.fn === "setCreator" ? "CreatorUpdated" : "CuratorUpdated";
  const logs = parseEventLogs({ abi: mezonkMarketsAbi, logs: receipt.logs, eventName, strict: false }).filter(
    (l) => l.address.toLowerCase() === deployment.marketsAddress!.toLowerCase(),
  );
  const match = logs.some((l) => {
    const a = l.args as Record<string, unknown>;
    const who = String(a.creator ?? a.curator ?? "").toLowerCase();
    return who === op.target && Boolean(a.approved) === op.grant;
  });
  if (!match) return set({ status: "failed", error: `The transaction succeeded but did not ${op.grant ? "grant" : "revoke"} this role for this wallet.` });
  const now = await publicClient.readContract({
    address: deployment.marketsAddress,
    abi: mezonkMarketsAbi,
    functionName: op.fn === "setCreator" ? "isCreator" : "isCurator",
    args: [op.target as Address],
  });
  if (Boolean(now) !== op.grant) return set({ error: "Confirmed, but a later transaction changed the role again." , status: "confirmed", confirmedBlock: receipt.blockNumber });
  invalidateRoles(op.target);
  const out = await set({ status: "confirmed", confirmedBlock: receipt.blockNumber, error: null });
  await audit("chain", "role_op.confirmed", "wallet", op.target, { operationId: opId, fn: op.fn, grant: op.grant, txHash: op.txHash, block: receipt.blockNumber.toString() });
  return out;
}

// ───────────────────────────── Compromised wallet ─────────────────────────────

/**
 * Incident response for a compromised wallet. Everything the backend controls happens now;
 * everything the contract controls is created as pending operations for the owner to sign.
 * Published markets keep their creator (the contract records it permanently).
 */
export async function replaceWallet(actor: Roles, oldWallet: string, newWallet: string, reason: string) {
  const oldW = normalizeWallet(oldWallet);
  const newW = normalizeWallet(newWallet);
  if (oldW === newW) throw deny(422, "same", "Old and new wallet are the same");
  if (oldW === actor.wallet) throw deny(409, "self", "Ask another administrator to replace your wallet");
  if (reason.trim().length < 10) throw deny(422, "reason_required", "Describe the incident (at least 10 characters)");
  const db = await getDb();
  const [proof] = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.wallet, newW)).limit(1);
  if (!proof) throw deny(409, "unverified", "The replacement wallet must sign in to MEZONK once first, to prove its owner controls it");
  const [newAcct] = await db.select().from(accounts).where(eq(accounts.wallet, newW));
  if (newAcct?.status === "suspended") throw deny(409, "suspended", "The replacement wallet is suspended");

  const incidentId = randomUUID();
  const oldRoles = await getRoles(oldW);
  const { sessionsRevoked } = await suspend(actor, oldW, `Compromised: ${reason}`, { incidentId });

  const adminMoved: string[] = [];
  const proposalsWithdrawn: string[] = [];
  const claimsReleased: string[] = [];
  await db.transaction(async (tx) => {
    const adminRows = await tx
      .update(roleAssignments)
      .set({ revokedAt: new Date(), revokedBy: actor.wallet, revokeReason: `incident ${incidentId}` })
      .where(and(eq(roleAssignments.wallet, oldW), isNull(roleAssignments.revokedAt)))
      .returning();
    for (const r of adminRows) {
      await tx.insert(roleAssignments).values({ wallet: newW, role: r.role, grantedBy: actor.wallet, reason: `Replacement for ${oldW} (incident ${incidentId})` }).onConflictDoNothing();
      adminMoved.push(r.role);
    }
    const open = await tx
      .update(marketProposals)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(and(eq(marketProposals.author, oldW), inArray(marketProposals.status, ["draft", "submitted", "under_review", "changes_requested"])))
      .returning({ id: marketProposals.id });
    proposalsWithdrawn.push(...open.map((o) => o.id));
    const claims = await tx
      .update(marketProposals)
      .set({ status: "submitted", assignedCurator: null, updatedAt: new Date() })
      .where(and(eq(marketProposals.assignedCurator, oldW), eq(marketProposals.status, "under_review")))
      .returning({ id: marketProposals.id });
    claimsReleased.push(...claims.map((c) => c.id));
  });

  // Approvals the old curator already signed stay valid on-chain until its curator flag is revoked or each nonce is cancelled.
  const approved = await db.select().from(marketProposals).where(inArray(marketProposals.status, ["approved", "scheduled"]));
  const exposedApprovals = approved
    .filter((p) => (p.approval as StoredApproval | null)?.curator?.toLowerCase() === oldW || (p.publisher ?? p.author) === oldW)
    .map((p) => ({ proposalId: p.id, nonce: (p.approval as StoredApproval).nonce }));

  const pendingOnChain = [];
  if (deployment.marketsAddress) {
    if (oldRoles.creator) {
      pendingOnChain.push(await createRoleOperation(actor, "setCreator", oldW, false, `incident ${incidentId}: revoke compromised wallet`, incidentId));
      pendingOnChain.push(await createRoleOperation(actor, "setCreator", newW, true, `incident ${incidentId}: replacement for ${oldW}`, incidentId));
    }
    if (oldRoles.curator) {
      pendingOnChain.push(await createRoleOperation(actor, "setCurator", oldW, false, `incident ${incidentId}: revoke compromised wallet`, incidentId));
      pendingOnChain.push(await createRoleOperation(actor, "setCurator", newW, true, `incident ${incidentId}: replacement for ${oldW}`, incidentId));
    }
  }

  const report = {
    incidentId,
    done: {
      accountSuspended: oldW,
      sessionsRevoked,
      platformRolesMoved: adminMoved,
      proposalsWithdrawn,
      reviewClaimsReleased: claimsReleased,
    },
    pending: {
      onChainOperations: pendingOnChain.map((o) => ({ id: o.id, fn: o.fn, target: o.target, grant: o.grant })),
      approvalsToCancel: exposedApprovals,
      ownerAction:
        oldRoles.owner
          ? "This wallet is the CONTRACT OWNER. The app cannot change that: transfer ownership (Ownable2Step) from a safe key or Safe immediately."
          : null,
      resolverOrArbitrator:
        oldRoles.resolver || oldRoles.arbitrator
          ? "Resolver/arbitrator assignments are fixed per market at creation and cannot be replaced for existing markets. Revoke with setResolver(false)/setConfig for future markets and watch its open markets for false proposals."
          : null,
    },
    attributionUnchanged: "Published markets, comments and reviews keep the original wallet as author.",
  };
  await db.insert(walletReplacements).values({ id: incidentId, oldWallet: oldW, newWallet: newW, performedBy: actor.wallet, reason, report });
  await audit(actor.wallet, "wallet.replace", "wallet", oldW, { incidentId, newWallet: newW, reason });
  await audit(actor.wallet, "wallet.replacement_for", "wallet", newW, { incidentId, oldWallet: oldW });
  invalidateRoles(oldW);
  invalidateRoles(newW);
  return report;
}
