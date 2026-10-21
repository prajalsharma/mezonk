import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { encodeFunctionData, getAddress, isAddress, parseEventLogs, type Address, type Hash, type Hex } from "viem";
import { policySchema, toContractPolicy, type PolicyInput } from "@/lib/orderbook/policy";
import type { StoredApproval } from "@/lib/governance/approval";
import { deployment } from "@/lib/chain/config";
import { exchangeAbi, factoryAbi } from "@/lib/contracts/abi";
import { audit } from "@/server/audit";
import { revokeAllSessions } from "@/server/auth";
import { publicClient } from "@/server/chain";
import { getDb, schema } from "@/server/db/client";
import { getRoles, invalidateRoles, type Roles } from "@/server/roles";

const { roleAssignments, accounts, sessions, roleOperations, walletReplacements, marketProposals, profiles, auditLog, platformFlags, restingOrders } = schema;

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
 * Wallets allowed to bootstrap themselves as the first administrators: INITIAL_ADMIN_WALLETS (comma-separated),
 * or the older single ADMIN_BOOTSTRAP_WALLET. Any malformed entry disables the bootstrap entirely (fail closed).
 * Server-only: never NEXT_PUBLIC_.
 */
export function bootstrapWallets(): string[] {
  const raw = [process.env.INITIAL_ADMIN_WALLETS, process.env.ADMIN_BOOTSTRAP_WALLET].filter(Boolean).join(",");
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!list.length || list.some((w) => !isAddress(w, { strict: false }))) return [];
  return [...new Set(list.map((w) => w.toLowerCase()))];
}

const BOOTSTRAP_CLOSED = "admin_bootstrap_closed";

/**
 * One-time administrator bootstrap. Runs only after the wallet proved control with a fresh SIWE signature
 * (it is called from session creation). A listed wallet becomes ADMINISTRATOR once, recorded by an atomic
 * insert of a durable per-wallet flag, and only while the bootstrap is open. The bootstrap closes for good
 * when routine administration starts (any grant or revoke from /admin) or an administrator closes it.
 * Signing in with an unlisted wallet never grants anything.
 */
export async function maybeBootstrapAdmin(wallet: string): Promise<boolean> {
  const w = wallet.toLowerCase();
  if (!bootstrapWallets().includes(w)) return false;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [closed] = await tx.select().from(platformFlags).where(eq(platformFlags.key, BOOTSTRAP_CLOSED));
    if (closed) return false;
    const claimed = await tx
      .insert(platformFlags)
      .values({ key: `admin_bootstrap:${w}`, value: { at: new Date().toISOString() } })
      .onConflictDoNothing()
      .returning();
    if (!claimed.length) return false; // this wallet already used its bootstrap
    await tx.insert(roleAssignments).values({ wallet: w, role: "ADMINISTRATOR", grantedBy: "bootstrap", reason: "INITIAL_ADMIN_WALLETS first sign-in" }).onConflictDoNothing();
    await tx.insert(auditLog).values({ actor: w, action: "role.grant", subjectType: "wallet", subjectId: w, details: { role: "ADMINISTRATOR", via: "bootstrap" } });
    return true;
  });
}

/** Ends the bootstrap permanently. Idempotent. */
export async function closeBootstrap(actor: string, reason: string) {
  const db = await getDb();
  const r = await db.insert(platformFlags).values({ key: BOOTSTRAP_CLOSED, value: { by: actor, reason, at: new Date().toISOString() } }).onConflictDoNothing().returning();
  if (r.length) await audit(actor, "bootstrap.close", "platform", "admin_bootstrap", { reason });
  return { closed: true };
}

export async function bootstrapStatus() {
  const db = await getDb();
  const [closed] = await db.select().from(platformFlags).where(eq(platformFlags.key, BOOTSTRAP_CLOSED));
  return { configured: bootstrapWallets().length, closed: !!closed };
}

export async function grantAdmin(actor: Roles, target: string, reason: string) {
  const t = normalizeWallet(target);
  if (reason.trim().length < 5) throw deny(422, "reason_required", "Give a reason (at least 5 characters)");
  const db = await getDb();
  const [acct] = await db.select().from(accounts).where(eq(accounts.wallet, t));
  if (acct?.status === "suspended") throw deny(409, "suspended", "Restore the account before granting a role");
  const inserted = await db.insert(roleAssignments).values({ wallet: t, role: "ADMINISTRATOR", grantedBy: actor.wallet, reason }).onConflictDoNothing().returning();
  if (!inserted.length) throw deny(409, "already", "This wallet is already an administrator");
  await closeBootstrap(actor.wallet, "routine administration started");
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
  await closeBootstrap(actor.wallet, "routine administration started");
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
  const [roles, profile, acct, assignments, live, ops, events, lp] = await Promise.all([
    getRoles(t),
    db.select().from(profiles).where(eq(profiles.wallet, t)),
    db.select().from(accounts).where(eq(accounts.wallet, t)),
    db.select().from(roleAssignments).where(eq(roleAssignments.wallet, t)).orderBy(desc(roleAssignments.grantedAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(sessions).where(and(eq(sessions.wallet, t), isNull(sessions.revokedAt), sql`${sessions.expiresAt} > now()`)),
    db.select().from(roleOperations).where(eq(roleOperations.target, t)).orderBy(desc(roleOperations.createdAt)).limit(50),
    db.select().from(auditLog).where(and(eq(auditLog.subjectType, "wallet"), eq(auditLog.subjectId, t))).orderBy(desc(auditLog.createdAt)).limit(50),
    db
      .select({
        open: sql<number>`count(*) filter (where ${restingOrders.status} = 'open')::int`,
        seededMarkets: sql<number>`count(distinct ${restingOrders.marketId}) filter (where ${restingOrders.seed})::int`,
      })
      .from(restingOrders)
      .where(eq(restingOrders.maker, t)),
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
    /** Liquidity provider is a fact, not a role: derived from real escrowed orders. Nobody grants it. */
    liquidity: { openEscrowedOrders: lp[0]?.open ?? 0, seededMarkets: lp[0]?.seededMarkets ?? 0 },
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
type PolicyFn = "addPolicy" | "setPolicyActive";
type OpFn = RoleFn | PolicyFn;
type OpRow = typeof roleOperations.$inferSelect;
const isPolicyFn = (fn: string): fn is PolicyFn => fn === "addPolicy" || fn === "setPolicyActive";

function calldataOf(o: OpRow): Hex {
  if (o.fn === "addPolicy") return encodeFunctionData({ abi: exchangeAbi, functionName: "addPolicy", args: [toContractPolicy(o.params as PolicyInput)] });
  if (o.fn === "setPolicyActive") {
    const p = o.params as { policyId: number };
    return encodeFunctionData({ abi: exchangeAbi, functionName: "setPolicyActive", args: [p.policyId, o.grant] });
  }
  return encodeFunctionData({ abi: factoryAbi, functionName: o.fn as RoleFn, args: [getAddress(o.target), o.grant] });
}

function serializeOp(o: OpRow) {
  return {
    id: o.id,
    fn: o.fn as OpFn,
    target: getAddress(o.target),
    grant: o.grant,
    params: o.params ?? null,
    status: o.status,
    txHash: o.txHash,
    error: o.error,
    reason: o.reason,
    requestedBy: o.requestedBy,
    incidentId: o.incidentId,
    confirmedBlock: o.confirmedBlock?.toString() ?? null,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    calldata: calldataOf(o),
    // Roles live on the factory; policies on the exchange. Each has its own owner (initially the same wallet).
    contract: isPolicyFn(o.fn) ? deployment.marketsAddress : deployment.factoryAddress,
  };
}

/**
 * Records a requested protocol role change. It is NOT a change: the factory owner must sign it.
 * The response carries the exact calldata so a Safe owner can propose it in the Safe UI.
 */
export async function createRoleOperation(actor: Roles, fn: RoleFn, target: string, grant: boolean, reason: string, incidentId?: string) {
  if (!deployment.factoryAddress) throw deny(503, "no_deployment", "No market contract is configured");
  const t = normalizeWallet(target);
  if (reason.trim().length < 5) throw deny(422, "reason_required", "Give a reason (at least 5 characters)");
  const db = await getDb();
  const [row] = await db.insert(roleOperations).values({ id: randomUUID(), fn, target: t, grant, requestedBy: actor.wallet, reason, incidentId: incidentId ?? null }).returning();
  await audit(actor.wallet, "role_op.create", "wallet", t, { fn, grant, reason, operationId: row!.id, incidentId });
  const owner = await publicClient.readContract({ address: deployment.factoryAddress, abi: factoryAbi, functionName: "owner" }).catch(() => null);
  return { ...serializeOp(row!), owner };
}

/**
 * Records a requested policy change on the exchange (a new immutable policy version, or retiring/re-enabling one
 * for NEW markets). Existing markets keep the policy they were published under; nothing here can change them.
 */
export async function createPolicyOperation(actor: Roles, op: { fn: "addPolicy"; policy: PolicyInput } | { fn: "setPolicyActive"; policyId: number; active: boolean }, reason: string) {
  if (!deployment.marketsAddress) throw deny(503, "no_deployment", "No market contract is configured");
  if (reason.trim().length < 5) throw deny(422, "reason_required", "Give a reason (at least 5 characters)");
  const db = await getDb();
  const values =
    op.fn === "addPolicy"
      ? { fn: op.fn, grant: true, params: policySchema.parse(op.policy) }
      : { fn: op.fn, grant: op.active, params: { policyId: op.policyId } };
  const [row] = await db
    .insert(roleOperations)
    .values({ id: randomUUID(), target: deployment.marketsAddress.toLowerCase(), requestedBy: actor.wallet, reason, ...values })
    .returning();
  await audit(actor.wallet, "policy_op.create", "policy", op.fn === "addPolicy" ? "new" : String(op.policyId), { ...values, reason, operationId: row!.id });
  const owner = await publicClient.readContract({ address: deployment.marketsAddress, abi: exchangeAbi, functionName: "owner" }).catch(() => null);
  return { ...serializeOp(row!), owner };
}

export async function listPolicyOperations() {
  const db = await getDb();
  const rows = await db.select().from(roleOperations).where(inArray(roleOperations.fn, ["addPolicy", "setPolicyActive"])).orderBy(desc(roleOperations.createdAt)).limit(50);
  return rows.map(serializeOp);
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

const samePolicy = (a: Record<string, unknown>, b: PolicyInput) =>
  (Object.keys(b) as Array<keyof PolicyInput>).every((k) => String(a[k]) === String(b[k]));

/**
 * Confirms an operation only from chain facts: a successful receipt containing the matching event emitted by
 * the right contract (works for EOA owners and Safes), plus a fresh read that the state now has the requested
 * value. Idempotent; safe to call repeatedly.
 */
export async function reconcileRoleOperation(opId: string) {
  const db = await getDb();
  const [op] = await db.select().from(roleOperations).where(eq(roleOperations.id, opId));
  if (!op) throw deny(404, "not_found", "No such operation");
  const contract = isPolicyFn(op.fn) ? deployment.marketsAddress : deployment.factoryAddress;
  if (op.status === "confirmed" || !op.txHash || !contract) return serializeOp(op);
  const set = async (patch: Partial<OpRow>) => {
    const [r] = await db.update(roleOperations).set({ ...patch, updatedAt: new Date() }).where(eq(roleOperations.id, opId)).returning();
    return serializeOp(r!);
  };
  const receipt = await publicClient.getTransactionReceipt({ hash: op.txHash as Hash }).catch(() => null);
  if (!receipt) return serializeOp(op); // not mined yet (or unknown hash): stays "submitted"
  if (receipt.status !== "success") return set({ status: "failed", error: "The transaction reverted on-chain. Nothing changed." });
  const from = (l: { address: string }) => l.address.toLowerCase() === contract.toLowerCase();

  if (op.fn === "addPolicy") {
    const ev = parseEventLogs({ abi: exchangeAbi, logs: receipt.logs, eventName: "PolicyAdded", strict: false }).filter(from);
    const hit = ev.find((l) => samePolicy((l.args as { policy: Record<string, unknown> }).policy, op.params as PolicyInput));
    if (!hit) return set({ status: "failed", error: "The transaction succeeded but did not add this exact policy." });
    const id = Number((hit.args as { policyId: number }).policyId);
    const stored = await publicClient.readContract({ address: contract, abi: exchangeAbi, functionName: "getPolicy", args: [id] });
    if (!samePolicy(stored as unknown as Record<string, unknown>, op.params as PolicyInput)) return set({ status: "failed", error: "The on-chain policy differs from the request." });
    const out = await set({ status: "confirmed", confirmedBlock: receipt.blockNumber, error: null, params: { ...(op.params as object), policyId: id } });
    await audit("chain", "policy_op.confirmed", "policy", String(id), { operationId: opId, txHash: op.txHash });
    return out;
  }
  if (op.fn === "setPolicyActive") {
    const pid = (op.params as { policyId: number }).policyId;
    const ev = parseEventLogs({ abi: exchangeAbi, logs: receipt.logs, eventName: "PolicyActiveSet", strict: false }).filter(from);
    if (!ev.some((l) => Number((l.args as { policyId: number }).policyId) === pid && Boolean((l.args as { active: boolean }).active) === op.grant)) {
      return set({ status: "failed", error: "The transaction succeeded but did not change this policy." });
    }
    const now = await publicClient.readContract({ address: contract, abi: exchangeAbi, functionName: "policyActive", args: [pid] });
    const out = await set({ status: "confirmed", confirmedBlock: receipt.blockNumber, error: now === op.grant ? null : "Confirmed, but a later transaction changed it again." });
    await audit("chain", "policy_op.confirmed", "policy", String(pid), { operationId: opId, active: op.grant, txHash: op.txHash });
    return out;
  }

  const eventName = op.fn === "setCreator" ? "CreatorUpdated" : "CuratorUpdated";
  const logs = parseEventLogs({ abi: factoryAbi, logs: receipt.logs, eventName, strict: false }).filter(from);
  const match = logs.some((l) => {
    const a = l.args as Record<string, unknown>;
    const who = String(a.creator ?? a.curator ?? "").toLowerCase();
    return who === op.target && Boolean(a.approved) === op.grant;
  });
  if (!match) return set({ status: "failed", error: `The transaction succeeded but did not ${op.grant ? "grant" : "revoke"} this role for this wallet.` });
  const now = await publicClient.readContract({
    address: contract,
    abi: factoryAbi,
    functionName: op.fn === "setCreator" ? "isCreator" : "isCurator",
    args: [op.target as Address],
  });
  if (Boolean(now) !== op.grant) return set({ error: "Confirmed, but a later transaction changed the role again.", status: "confirmed", confirmedBlock: receipt.blockNumber });
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
