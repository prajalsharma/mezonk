import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { keccak256, toBytes, verifyTypedData, type Address, type Hex } from "viem";
import { deployment } from "@/lib/chain/config";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
import { approvalDomain, approvalTypes, type StoredApproval } from "@/lib/governance/approval";
import {
  canTransition,
  proposalInputSchema,
  type ProposalInput,
  type ProposalStatus,
} from "@/lib/governance/proposal";
import { metadataHash, reviewMetadata, serializeMetadata, type MarketMetadata } from "@/lib/market/metadata";
import { publicClient } from "@/server/chain";
import { getDb, schema } from "@/server/db/client";
import { listMarkets } from "@/server/queries";
import { profilesFor } from "@/server/profiles";
import { getRoles, hasCap, type Roles } from "@/server/roles";

const { marketProposals, proposalReviews, auditLog, projects, projectRepresentatives } = schema;

export class GovernanceError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}
const deny = (status: number, code: string, msg: string) => new GovernanceError(status, code, msg);

async function audit(actor: string, action: string, subjectType: string, subjectId: string, details?: unknown) {
  const db = await getDb();
  await db.insert(auditLog).values({ actor: actor.toLowerCase(), action, subjectType, subjectId, details: details ?? null });
}

export type ProposalRow = typeof marketProposals.$inferSelect;

/** Public view: strips the author's private fields when the viewer isn't the author or a curator. */
export function publicProposal(p: ProposalRow, viewer?: Roles | null) {
  const privileged = !!viewer && (hasCap(viewer, "market:review") || viewer.admin || viewer.wallet === p.author);
  return {
    id: p.id,
    author: p.author,
    projectId: p.projectId,
    status: p.status as ProposalStatus,
    version: p.version,
    metadata: p.metadata as MarketMetadata,
    metadataHash: p.metadataHash,
    closeTime: p.closeTime.toISOString(),
    launchWindow: p.launchWindow,
    resolver: p.resolver,
    publisher: p.publisher ?? p.author,
    rationale: p.rationale,
    references: p.references_,
    sponsored: p.sponsored,
    summary: p.summary,
    conflicts: p.conflicts,
    marketId: p.marketId,
    submittedAt: p.submittedAt?.toISOString() ?? null,
    decidedAt: p.decidedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    assignedCurator: p.assignedCurator,
    // The signed approval is public once it exists: it is bound to one creator and one metadata hash,
    // single-use on-chain, and the publish transaction reveals it anyway.
    approval: (p.approval as StoredApproval | null) ?? null,
    ...(privileged ? { liquidityPlan: p.liquidityPlan } : {}),
  };
}

async function similarOpenMarkets(question: string) {
  const words = question.toLowerCase().replace(/[^a-z0-9$ ]/g, " ").split(/\s+/).filter((w) => w.length > 3);
  const pool = (await listMarkets({ status: "open", limit: 500, offset: 0 })).items;
  return pool
    .map((m) => {
      const q = m.question.toLowerCase();
      const hits = words.filter((w) => q.includes(w)).length;
      return { id: m.id, question: m.question, score: words.length ? hits / words.length : 0 };
    })
    .filter((m) => m.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

async function similarProposals(question: string, excludeId?: string) {
  const db = await getDb();
  const words = question.toLowerCase().replace(/[^a-z0-9$ ]/g, " ").split(/\s+/).filter((w) => w.length > 3);
  const rows = await db
    .select({ id: marketProposals.id, metadata: marketProposals.metadata, status: marketProposals.status })
    .from(marketProposals)
    .where(and(inArray(marketProposals.status, ["submitted", "under_review", "approved", "scheduled", "published"]), excludeId ? ne(marketProposals.id, excludeId) : undefined));
  return rows
    .map((r) => {
      const q = String((r.metadata as { question?: string }).question ?? "").toLowerCase();
      const hits = words.filter((w) => q.includes(w)).length;
      return { id: r.id, question: (r.metadata as { question: string }).question, status: r.status, score: words.length ? hits / words.length : 0 };
    })
    .filter((m) => m.score >= 0.6)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/** Validation shared by create/edit/submit. Returns review issues (never throws for warnings). */
export async function checkProposal(input: ProposalInput, excludeId?: string) {
  const issues = reviewMetadata(input.metadata, new Date(input.closeTime));
  const similarMarkets = await similarOpenMarkets(input.metadata.question);
  const similar = await similarProposals(input.metadata.question, excludeId);
  if (input.sponsored && !input.conflicts.trim()) {
    issues.push({ field: "conflicts", message: "Sponsored or project-proposed markets must disclose the relationship.", blocking: true });
  }
  if (input.projectId) {
    const db = await getDb();
    const [proj] = await db.select().from(projects).where(eq(projects.id, input.projectId));
    if (!proj) issues.push({ field: "projectId", message: "Unknown project.", blocking: true });
  }
  return { issues, similarMarkets, similarProposals: similar };
}

export async function createProposal(author: string, raw: unknown) {
  const input = proposalInputSchema.parse(raw);
  await validateProposalMedia(author, input); // before any write, so a bad image leaves nothing behind
  const db = await getDb();
  const id = randomUUID();
  const mh = metadataHash(serializeMetadata(input.metadata));
  const [row] = await db
    .insert(marketProposals)
    .values({
      id,
      author: author.toLowerCase(),
      projectId: input.projectId ?? null,
      metadata: input.metadata,
      metadataHash: mh,
      closeTime: new Date(input.closeTime),
      launchWindow: input.launchWindow,
      resolver: input.resolver?.toLowerCase() ?? null,
      liquidityPlan: input.liquidityPlan,
      conflicts: input.conflicts,
      rationale: input.rationale,
      references_: input.references,
      sponsored: input.sponsored,
      summary: input.summary,
    })
    .returning();
  await setProposalMedia(id, author, input);
  await audit(author, "proposal.create", "proposal", id);
  return row!;
}

export async function updateProposal(id: string, author: string, raw: unknown) {
  const db = await getDb();
  const [p] = await db.select().from(marketProposals).where(eq(marketProposals.id, id));
  if (!p) throw deny(404, "not_found", "No such proposal");
  if (p.author !== author.toLowerCase()) throw deny(403, "forbidden", "Only the author can edit a proposal");
  if (!["draft", "changes_requested"].includes(p.status)) throw deny(409, "locked", "This proposal can't be edited in its current state");
  const input = proposalInputSchema.parse(raw);
  await validateProposalMedia(author, input);
  const mh = metadataHash(serializeMetadata(input.metadata));
  const [row] = await db
    .update(marketProposals)
    .set({
      projectId: input.projectId ?? null,
      metadata: input.metadata,
      metadataHash: mh,
      closeTime: new Date(input.closeTime),
      launchWindow: input.launchWindow,
      resolver: input.resolver?.toLowerCase() ?? null,
      liquidityPlan: input.liquidityPlan,
      conflicts: input.conflicts,
      rationale: input.rationale,
      references_: input.references,
      sponsored: input.sponsored,
      summary: input.summary,
      version: p.metadataHash === mh ? p.version : p.version + 1,
      updatedAt: new Date(),
    })
    .where(eq(marketProposals.id, id))
    .returning();
  await setProposalMedia(id, author, input);
  await audit(author, "proposal.update", "proposal", id, { version: row!.version });
  return row!;
}

/** Author actions: submit (incl. resubmit) and withdraw. */
export async function authorAction(id: string, author: string, action: "submit" | "withdraw") {
  const db = await getDb();
  const [p] = await db.select().from(marketProposals).where(eq(marketProposals.id, id));
  if (!p) throw deny(404, "not_found", "No such proposal");
  if (p.author !== author.toLowerCase()) throw deny(403, "forbidden", "Only the author can do this");
  if (!canTransition(action, p.status as ProposalStatus)) throw deny(409, "bad_transition", `Can't ${action} a proposal that is ${p.status}`);
  if (action === "submit") {
    const check = await checkProposal(proposalInputSchema.parse({ ...p, references: p.references_, metadata: p.metadata, closeTime: p.closeTime.toISOString() }), id);
    const blocking = check.issues.filter((i) => i.blocking);
    if (blocking.length) throw deny(422, "blocking_issues", blocking.map((b) => b.message).join(" "));
  }
  const status: ProposalStatus = action === "submit" ? "submitted" : "withdrawn";
  const resubmit = action === "submit" && p.status === "changes_requested";
  const [row] = await db
    .update(marketProposals)
    .set({ status, submittedAt: action === "submit" ? new Date() : p.submittedAt, assignedCurator: null, updatedAt: new Date() })
    .where(eq(marketProposals.id, id))
    .returning();
  await db.insert(proposalReviews).values({ proposalId: id, proposalVersion: p.version, reviewer: author.toLowerCase(), action: resubmit ? "resubmit" : action });
  await audit(author, `proposal.${action}`, "proposal", id, { version: p.version });
  return row!;
}

/** How long a curator approval stays valid. Bounded so an approved-but-unpublished market can't go stale. */
const APPROVAL_TTL_S = 14 * 86400;

/** The approval a curator must sign for a proposal (deterministic per proposal version). */
export async function buildApproval(p: ProposalRow): Promise<Omit<StoredApproval, "curator" | "signature">> {
  if (!p.resolver) throw deny(422, "no_resolver", "Assign a resolver before approving");
  const publisher = (p.publisher ?? p.author) as Address;
  const cfg = deployment.marketsAddress
    ? await publicClient.readContract({ address: deployment.marketsAddress, abi: mezonkMarketsAbi, functionName: "config" })
    : null;
  const minDuration = cfg ? Number(cfg[2]) : 3600;
  const closeTime = Math.floor(p.closeTime.getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  const latest = closeTime - minDuration - 300;
  const deadline = Math.min(now + APPROVAL_TTL_S, latest);
  if (deadline <= now) throw deny(422, "too_late", "The proposed close time is too soon to publish. Ask for a later close time.");
  return {
    metadataHash: p.metadataHash as Hex,
    creator: publisher,
    resolver: p.resolver as Address,
    closeTime: String(closeTime),
    deadline: String(deadline),
    nonce: keccak256(toBytes(`${p.id}:${p.version}`)),
  };
}

export async function curatorAction(
  id: string,
  curator: Roles,
  body: {
    action: string;
    reason: string;
    checklist?: Record<string, boolean>;
    duplicateOf?: string;
    internal: boolean;
    signature?: string;
    approval?: Record<string, string>;
    resolver?: string;
    publisher?: string;
  },
) {
  if (!hasCap(curator, "market:review")) throw deny(403, "forbidden", "Only an on-chain approved curator can review proposals");
  const db = await getDb();
  const [p] = await db.select().from(marketProposals).where(eq(marketProposals.id, id));
  if (!p) throw deny(404, "not_found", "No such proposal");
  if (p.author === curator.wallet) throw deny(403, "self_review", "You can't review your own proposal");
  const { action } = body;

  if (action === "assign") {
    // Resolver and publisher are chosen by the curator, never the author, and both are checked on-chain.
    if (!["submitted", "under_review", "changes_requested"].includes(p.status)) throw deny(409, "locked", "Assignments can only change before approval");
    if (!deployment.marketsAddress) throw deny(503, "no_deployment", "No market contract is configured");
    const base = { address: deployment.marketsAddress, abi: mezonkMarketsAbi } as const;
    const set: Partial<typeof marketProposals.$inferInsert> = { updatedAt: new Date() };
    if (body.resolver) {
      const ok = await publicClient.readContract({ ...base, functionName: "isResolver", args: [body.resolver as Address] });
      if (!ok) throw deny(422, "not_resolver", "That address is not an approved resolver");
      set.resolver = body.resolver.toLowerCase();
    }
    if (body.publisher) {
      const ok = await publicClient.readContract({ ...base, functionName: "isCreator", args: [body.publisher as Address] });
      if (!ok) throw deny(422, "not_creator", "That address is not an approved creator");
      if (body.publisher.toLowerCase() === curator.wallet) throw deny(422, "self_publish", "You can't publish a market you review (the contract rejects self-approval)");
      set.publisher = body.publisher.toLowerCase();
    }
    const [row] = await db.update(marketProposals).set(set).where(eq(marketProposals.id, id)).returning();
    await db.insert(proposalReviews).values({ proposalId: id, proposalVersion: p.version, reviewer: curator.wallet, action, reason: body.reason, internal: body.internal });
    await audit(curator.wallet, "proposal.assign", "proposal", id, { resolver: set.resolver, publisher: set.publisher });
    return row!;
  }

  if (action === "note") {
    await db.insert(proposalReviews).values({ proposalId: id, proposalVersion: p.version, reviewer: curator.wallet, action, reason: body.reason, internal: body.internal });
    await audit(curator.wallet, "proposal.note", "proposal", id);
    return p;
  }
  if (action === "unassign") {
    if (p.assignedCurator !== curator.wallet) throw deny(409, "not_assigned", "This proposal isn't assigned to you");
    const [row] = await db.update(marketProposals).set({ status: "submitted", assignedCurator: null, updatedAt: new Date() }).where(eq(marketProposals.id, id)).returning();
    await db.insert(proposalReviews).values({ proposalId: id, proposalVersion: p.version, reviewer: curator.wallet, action });
    await audit(curator.wallet, "proposal.unassign", "proposal", id);
    return row!;
  }
  if (!canTransition(action, p.status as ProposalStatus)) throw deny(409, "bad_transition", `Can't ${action} a proposal that is ${p.status}`);
  if (p.assignedCurator && p.assignedCurator !== curator.wallet && action !== "claim") {
    throw deny(409, "assigned_elsewhere", "Another curator is reviewing this proposal");
  }
  if ((action === "reject" || action === "request_changes") && body.reason.trim().length < 10) {
    throw deny(422, "reason_required", "Give the author a reason (at least 10 characters)");
  }

  let set: Partial<typeof marketProposals.$inferInsert> = { updatedAt: new Date() };
  if (action === "claim") set = { ...set, status: "under_review", assignedCurator: curator.wallet };
  if (action === "request_changes") set = { ...set, status: "changes_requested", assignedCurator: null };
  if (action === "reject") set = { ...set, status: "rejected", decidedAt: new Date() };
  if (action === "approve") {
    if (!body.signature || !body.approval) throw deny(422, "signature_required", "Approval needs the curator's EIP-712 signature");
    const expected = await buildApproval(p);
    for (const k of Object.keys(expected) as Array<keyof typeof expected>) {
      if (String(body.approval[k]).toLowerCase() !== String(expected[k]).toLowerCase()) {
        throw deny(422, "approval_mismatch", `Signed approval differs from the proposal (${k}). Reload and sign again.`);
      }
    }
    if (!deployment.marketsAddress) throw deny(503, "no_deployment", "No market contract is configured");
    // verifyTypedData handles both EOAs and ERC-1271 contract curators (e.g. a Safe).
    const valid = await verifyTypedData({
      address: curator.wallet as Address,
      domain: approvalDomain(deployment.chainId, deployment.marketsAddress),
      types: approvalTypes,
      primaryType: "MarketApproval",
      message: {
        metadataHash: expected.metadataHash,
        creator: expected.creator,
        resolver: expected.resolver,
        closeTime: BigInt(expected.closeTime),
        deadline: BigInt(expected.deadline),
        nonce: expected.nonce as Hex,
      },
      signature: body.signature as Hex,
    }).catch(() => false);
    if (!valid) throw deny(401, "bad_signature", "The signature doesn't verify for this curator");
    const checklist = body.checklist ?? {};
    const missing = ["objective", "source", "deadline", "invalid", "duplicate", "policy", "conflict"].filter((k) => !checklist[k]);
    if (missing.length) throw deny(422, "checklist_incomplete", `Complete the review checklist: ${missing.join(", ")}`);
    const stored: StoredApproval = { ...expected, curator: curator.wallet as Address, signature: body.signature as Hex };
    set = { ...set, status: "approved", approval: stored, decidedAt: new Date(), assignedCurator: curator.wallet };
  }

  const [row] = await db.update(marketProposals).set(set).where(eq(marketProposals.id, id)).returning();
  await db.insert(proposalReviews).values({
    proposalId: id,
    proposalVersion: p.version,
    reviewer: curator.wallet,
    action,
    reason: body.reason,
    checklist: body.checklist ?? null,
    duplicateOf: body.duplicateOf ?? null,
    internal: body.internal,
  });
  await audit(curator.wallet, `proposal.${action}`, "proposal", id, { version: p.version, reason: body.reason });
  return row!;
}

export async function listProposals(opts: { status?: string[]; author?: string; publisher?: string; viewer?: Roles | null; limit: number; offset: number; publicOnly?: boolean }) {
  const db = await getDb();
  const conds = [];
  if (opts.status?.length) conds.push(inArray(marketProposals.status, opts.status));
  if (opts.author) conds.push(eq(marketProposals.author, opts.author.toLowerCase()));
  // "Mine to publish": approved proposals where this wallet is the designated publisher (or the author with no override).
  if (opts.publisher) {
    const w = opts.publisher.toLowerCase();
    conds.push(or(eq(marketProposals.publisher, w), and(sql`${marketProposals.publisher} is null`, eq(marketProposals.author, w)))!);
  }
  // Public listings never show drafts or withdrawn proposals.
  if (opts.publicOnly) conds.push(or(ne(marketProposals.status, "draft"), eq(marketProposals.author, opts.viewer?.wallet ?? ""))!, ne(marketProposals.status, "withdrawn"));
  const rows = await db.select().from(marketProposals).where(and(...conds)).orderBy(desc(marketProposals.updatedAt)).limit(opts.limit).offset(opts.offset);
  const [cnt] = await db.select({ n: sql<number>`count(*)::int` }).from(marketProposals).where(and(...conds));
  return { total: cnt?.n ?? 0, items: rows.map((r) => publicProposal(r, opts.viewer)) };
}

export async function getProposal(id: string, viewer?: Roles | null) {
  const db = await getDb();
  const [p] = await db.select().from(marketProposals).where(eq(marketProposals.id, id));
  if (!p) return null;
  const privileged = !!viewer && (hasCap(viewer, "market:review") || viewer.admin || viewer.wallet === p.author);
  if (p.status === "draft" && !privileged) return null;
  const reviews = await db
    .select()
    .from(proposalReviews)
    .where(and(eq(proposalReviews.proposalId, id), privileged ? undefined : eq(proposalReviews.internal, false)))
    .orderBy(proposalReviews.createdAt);
  const [project] = p.projectId ? await db.select().from(projects).where(eq(projects.id, p.projectId)) : [];
  const [rep] = p.projectId
    ? await db.select().from(projectRepresentatives).where(and(eq(projectRepresentatives.projectId, p.projectId), eq(projectRepresentatives.wallet, p.author)))
    : [];
  const check = privileged
    ? await checkProposal(proposalInputSchema.parse({ ...p, references: p.references_, metadata: p.metadata, closeTime: p.closeTime.toISOString() }), id).catch(() => null)
    : null;
  return {
    proposal: publicProposal(p, viewer),
    media: await proposalMediaList(id),
    reviews: reviews.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    project: project ? { id: project.id, name: project.name, status: project.status, website: project.website } : null,
    authorIsVerifiedRep: rep?.status === "verified",
    check,
  };
}

/** Called by the indexer when MarketApprovalUsed(marketId, curator, nonce) is seen. */
export async function linkPublishedMarket(marketId: number, nonce: string) {
  const db = await getDb();
  const rows = await db.select().from(marketProposals).where(inArray(marketProposals.status, ["approved", "scheduled", "published"]));
  const p = rows.find((r) => ((r.approval as StoredApproval | null)?.nonce ?? "").toLowerCase() === nonce.toLowerCase());
  if (!p || p.marketId === marketId) return;
  await db.update(marketProposals).set({ status: "published", marketId, updatedAt: new Date() }).where(eq(marketProposals.id, p.id));
  await db.insert(proposalReviews).values({ proposalId: p.id, proposalVersion: p.version, reviewer: "chain", action: "publish", reason: `market #${marketId}` });
  await audit("chain", "proposal.publish", "proposal", p.id, { marketId });
}

// ───────────────────────────── Projects ─────────────────────────────

export async function createProject(wallet: string, input: { id: string; name: string; website?: string; description?: string; proofUrl?: string }) {
  const db = await getDb();
  const [existing] = await db.select().from(projects).where(eq(projects.id, input.id));
  if (existing) throw deny(409, "exists", "A project with this id already exists");
  await db.insert(projects).values({ id: input.id, name: input.name, website: input.website ?? null, description: input.description ?? "", createdBy: wallet.toLowerCase() });
  await db.insert(projectRepresentatives).values({ projectId: input.id, wallet: wallet.toLowerCase(), proofUrl: input.proofUrl ?? null });
  await audit(wallet, "project.create", "project", input.id);
}

export async function reviewProject(curator: Roles, projectId: string, wallet: string, verdict: "verified" | "revoked", reason: string) {
  if (!hasCap(curator, "project:verify")) throw deny(403, "forbidden", "Only a curator or administrator can verify project representatives");
  const db = await getDb();
  const [rep] = await db.select().from(projectRepresentatives).where(and(eq(projectRepresentatives.projectId, projectId), eq(projectRepresentatives.wallet, wallet.toLowerCase())));
  if (!rep) throw deny(404, "not_found", "No such representative claim");
  if (rep.wallet === curator.wallet) throw deny(403, "self_review", "You can't verify yourself");
  await db.update(projectRepresentatives).set({ status: verdict, reviewedBy: curator.wallet, reviewedAt: new Date() }).where(and(eq(projectRepresentatives.projectId, projectId), eq(projectRepresentatives.wallet, wallet.toLowerCase())));
  if (verdict === "verified") await db.update(projects).set({ status: "verified", verifiedBy: curator.wallet, verifiedAt: new Date() }).where(eq(projects.id, projectId));
  await audit(curator.wallet, `project.${verdict}`, "project", projectId, { wallet, reason });
}

export async function listProjects() {
  const db = await getDb();
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt));
  const reps = await db.select().from(projectRepresentatives);
  return rows.map((p) => ({
    ...p,
    createdAt: p.createdAt.toISOString(),
    verifiedAt: p.verifiedAt?.toISOString() ?? null,
    representatives: reps.filter((r) => r.projectId === p.id).map((r) => ({ wallet: r.wallet, status: r.status, proofUrl: r.proofUrl })),
  }));
}

export async function publicAudit(subjectType: string, subjectId: string) {
  const db = await getDb();
  const rows = await db.select().from(auditLog).where(and(eq(auditLog.subjectType, subjectType), eq(auditLog.subjectId, subjectId))).orderBy(auditLog.createdAt);
  return rows.map((r) => ({ actor: r.actor, action: r.action, createdAt: r.createdAt.toISOString() }));
}

export { getRoles };

// ───────────────────────────── Proposal images ─────────────────────────────

/**
 * Replaces a proposal's cover and context images. Only images uploaded by the proposal's author, of the
 * right kind and not removed, can be attached. Runs in one transaction.
 */
async function validateProposalMedia(author: string, input: ProposalInput) {
  const ids = [...(input.coverMediaId ? [input.coverMediaId] : []), ...input.contextMediaIds];
  const db = await getDb();
  const rows = ids.length ? await db.select().from(schema.media).where(inArray(schema.media.id, ids)) : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const m = byId.get(id);
    const wantKind = id === input.coverMediaId ? "cover" : "context";
    if (!m || m.owner !== author.toLowerCase() || m.kind !== wantKind || m.status === "removed") {
      throw deny(422, "bad_media", "One of the images can't be attached to this suggestion");
    }
  }
  return ids;
}

async function setProposalMedia(proposalId: string, author: string, input: ProposalInput) {
  const ids = await validateProposalMedia(author, input);
  const db = await getDb();
  await db.transaction(async (tx) => {
    await tx.delete(schema.proposalMedia).where(eq(schema.proposalMedia.proposalId, proposalId));
    if (input.coverMediaId) await tx.insert(schema.proposalMedia).values({ proposalId, mediaId: input.coverMediaId, role: "cover", position: 0 });
    for (const [i, mid] of input.contextMediaIds.entries()) {
      await tx.insert(schema.proposalMedia).values({ proposalId, mediaId: mid, role: "context", position: i + 1 }).onConflictDoNothing();
    }
    if (ids.length) await tx.update(schema.media).set({ status: "attached", attachedAt: new Date() }).where(inArray(schema.media.id, ids));
  });
}

export async function proposalMediaList(proposalId: string) {
  const db = await getDb();
  const rows = await db
    .select({ id: schema.media.id, url: schema.media.url, width: schema.media.width, height: schema.media.height, role: schema.proposalMedia.role, position: schema.proposalMedia.position, status: schema.media.status })
    .from(schema.proposalMedia)
    .innerJoin(schema.media, eq(schema.media.id, schema.proposalMedia.mediaId))
    .where(eq(schema.proposalMedia.proposalId, proposalId))
    .orderBy(schema.proposalMedia.position);
  return rows.filter((r) => r.status !== "removed").map(({ status: _s, ...r }) => r);
}

/** Everything the market page shows beyond chain data: who made it, the summary and images from its proposal. */
export async function marketPresentation(marketId: number, creator: string) {
  const db = await getDb();
  const [p] = await db.select().from(marketProposals).where(eq(marketProposals.marketId, marketId));
  const people = await profilesFor([creator, ...(p ? [p.author] : [])]);
  return {
    creator: people.get(creator.toLowerCase())!,
    suggestedBy: p && p.author !== creator.toLowerCase() ? people.get(p.author)! : null,
    proposalId: p?.id ?? null,
    summary: p?.summary ?? "",
    media: p ? await proposalMediaList(p.id) : [],
  };
}
