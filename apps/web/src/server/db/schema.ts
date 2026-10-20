import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Indexed copy of on-chain state. The chain is authoritative; every row here is reproducible
 * from `chain_events` (raw logs) plus contract reads. Token amounts are numeric(78,0) strings.
 */
const amount = (name: string) => numeric(name, { precision: 78, scale: 0 });

/** Raw decoded logs. Unique per (chain, tx, logIndex) so ingestion is idempotent. */
export const chainEvents = pgTable(
  "chain_events",
  {
    id: serial("id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    contract: text("contract").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockHash: text("block_hash").notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    eventName: text("event_name").notNull(),
    marketId: integer("market_id"),
    actor: text("actor"),
    args: jsonb("args").notNull(),
  },
  (t) => [
    uniqueIndex("chain_events_uniq").on(t.chainId, t.txHash, t.logIndex),
    index("chain_events_market").on(t.marketId, t.blockNumber),
    index("chain_events_actor").on(t.actor),
    index("chain_events_block").on(t.blockNumber),
  ],
);

export const markets = pgTable(
  "markets",
  {
    marketId: integer("market_id").primaryKey(),
    chainId: integer("chain_id").notNull(),
    contract: text("contract").notNull(),
    creator: text("creator").notNull(),
    resolver: text("resolver").notNull(),
    arbitrator: text("arbitrator").notNull(),
    metadataRaw: text("metadata_raw").notNull(),
    metadataHash: text("metadata_hash").notNull(),
    structured: boolean("structured").notNull(),
    question: text("question").notNull(),
    description: text("description").notNull().default(""),
    category: text("category").notNull(),
    rules: jsonb("rules"),
    sourceName: text("source_name"),
    sourceUrl: text("source_url"),
    resolvesAt: timestamp("resolves_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    createdBlock: bigint("created_block", { mode: "bigint" }).notNull(),
    createdTx: text("created_tx").notNull(),
    closeTime: timestamp("close_time", { withTimezone: true }).notNull(),
    feeBps: integer("fee_bps").notNull(),
    protocolFeeShareBps: integer("protocol_fee_share_bps").notNull(),
    proposalWindow: integer("proposal_window").notNull(),
    challengeWindow: integer("challenge_window").notNull(),
    arbitrationWindow: integer("arbitration_window").notNull(),
    proposerBond: amount("proposer_bond").notNull(),
    disputeBond: amount("dispute_bond").notNull(),
    initialLiquidity: amount("initial_liquidity").notNull(),
    initialYesProbBps: integer("initial_yes_prob_bps").notNull(),
    poolYes: amount("pool_yes").notNull(),
    poolNo: amount("pool_no").notNull(),
    collateral: amount("collateral").notNull(),
    priceYes: doublePrecision("price_yes").notNull(),
    volume: amount("volume").notNull(),
    tradeCount: integer("trade_count").notNull(),
    traderCount: integer("trader_count").notNull(),
    lastTradeAt: timestamp("last_trade_at", { withTimezone: true }),
    proposedOutcome: integer("proposed_outcome"),
    proposedAt: timestamp("proposed_at", { withTimezone: true }),
    challengeDeadline: timestamp("challenge_deadline", { withTimezone: true }),
    disputer: text("disputer"),
    disputedAt: timestamp("disputed_at", { withTimezone: true }),
    arbitrationDeadline: timestamp("arbitration_deadline", { withTimezone: true }),
    finalOutcome: integer("final_outcome"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    finalizeReason: integer("finalize_reason"),
    lastEventBlock: bigint("last_event_block", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("markets_close").on(t.closeTime),
    index("markets_category").on(t.category),
    index("markets_creator").on(t.creator),
  ],
);

export const trades = pgTable(
  "trades",
  {
    eventId: integer("event_id")
      .primaryKey()
      .references(() => chainEvents.id, { onDelete: "cascade" }),
    marketId: integer("market_id").notNull(),
    trader: text("trader").notNull(),
    side: text("side").notNull(), // "yes" | "no"
    isBuy: boolean("is_buy").notNull(),
    collateral: amount("collateral").notNull(),
    fee: amount("fee").notNull(),
    shares: amount("shares").notNull(),
    poolYes: amount("pool_yes").notNull(),
    poolNo: amount("pool_no").notNull(),
    priceYesAfter: doublePrecision("price_yes_after").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    txHash: text("tx_hash").notNull(),
  },
  (t) => [index("trades_market_time").on(t.marketId, t.blockTime), index("trades_trader").on(t.trader)],
);

/**
 * Per-account position, derived by replaying events.
 * Cost basis uses the average-cost method: a sale removes cost proportional to shares sold.
 */
export const positions = pgTable(
  "positions",
  {
    marketId: integer("market_id").notNull(),
    account: text("account").notNull(),
    yesShares: amount("yes_shares").notNull(),
    noShares: amount("no_shares").notNull(),
    yesCost: amount("yes_cost").notNull(),
    noCost: amount("no_cost").notNull(),
    realizedPnl: amount("realized_pnl").notNull(), // signed
    feesPaid: amount("fees_paid").notNull(),
    redeemed: boolean("redeemed").notNull(),
    redeemedPayout: amount("redeemed_payout").notNull(),
    isCreator: boolean("is_creator").notNull(),
    updatedBlock: bigint("updated_block", { mode: "bigint" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.marketId, t.account] }), index("positions_account").on(t.account)],
);

export const resolutionProposals = pgTable("resolution_proposals", {
  eventId: integer("event_id")
    .primaryKey()
    .references(() => chainEvents.id, { onDelete: "cascade" }),
  marketId: integer("market_id").notNull(),
  proposer: text("proposer").notNull(),
  outcome: integer("outcome").notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  evidenceUri: text("evidence_uri").notNull(),
  challengeDeadline: timestamp("challenge_deadline", { withTimezone: true }).notNull(),
  txHash: text("tx_hash").notNull(),
});

export const disputes = pgTable("disputes", {
  eventId: integer("event_id")
    .primaryKey()
    .references(() => chainEvents.id, { onDelete: "cascade" }),
  marketId: integer("market_id").notNull(),
  disputer: text("disputer").notNull(),
  evidenceHash: text("evidence_hash").notNull(),
  evidenceUri: text("evidence_uri").notNull(),
  arbitrationDeadline: timestamp("arbitration_deadline", { withTimezone: true }).notNull(),
  ruling: integer("ruling"),
  rulingRationaleHash: text("ruling_rationale_hash"),
  rulingRationaleUri: text("ruling_rationale_uri"),
  rulingTxHash: text("ruling_tx_hash"),
  txHash: text("tx_hash").notNull(),
});

/** Indexer cursor and health. One row per (chain, contract). */
export const indexerState = pgTable("indexer_state", {
  key: text("key").primaryKey(),
  lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
  lastBlockHash: text("last_block_hash"),
  headBlock: bigint("head_block", { mode: "bigint" }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastError: text("last_error"),
  lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
  reorgsHandled: integer("reorgs_handled").notNull().default(0),
  lastReconcileAt: timestamp("last_reconcile_at", { withTimezone: true }),
  reconcileMismatches: jsonb("reconcile_mismatches"),
});

/** Off-chain drafts. Not on-chain, never shown as markets. */
export const marketDrafts = pgTable("market_drafts", {
  id: text("id").primaryKey(),
  metadata: jsonb("metadata").notNull(),
  author: text("author"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** User-submitted evidence links, signed by the submitting wallet. Unverified by MEZONK. */
export const evidence = pgTable(
  "evidence",
  {
    id: serial("id").primaryKey(),
    marketId: integer("market_id").notNull(),
    author: text("author").notNull(),
    url: text("url").notNull(),
    note: text("note").notNull(),
    signature: text("signature").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_market").on(t.marketId)],
);

/**
 * Canonical evidence documents (proposal, dispute, arbitration rationale). The keccak256 of `raw`
 * is what gets committed on-chain, so any copy of this text can be verified against the chain.
 * Storing a document here proves nothing by itself; it only matters once its hash appears in an event.
 */
export const evidenceDocuments = pgTable(
  "evidence_documents",
  {
    hash: text("hash").primaryKey(),
    raw: text("raw").notNull(),
    kind: text("kind").notNull(),
    marketId: integer("market_id").notNull(),
    author: text("author").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evidence_documents_market").on(t.marketId)],
);

// ───────────────────────────── Market governance (off-chain workflow) ─────────────────────────────
// Publication itself is enforced by the contract (approved creator + curator-signed EIP-712 approval).
// These tables hold the review workflow, project verification and the audit trail around it.

/** Projects that may have verified representatives. Verification is a disclosure, never a protocol power. */
export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(), // slug
    name: text("name").notNull(),
    website: text("website"),
    description: text("description").notNull().default(""),
    status: text("status").notNull().default("pending"), // pending | verified | revoked
    verifiedBy: text("verified_by"), // curator wallet
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("projects_status").on(t.status)],
);

/** Wallets claiming to represent a project. */
export const projectRepresentatives = pgTable(
  "project_representatives",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    wallet: text("wallet").notNull(),
    role: text("role").notNull().default("representative"),
    proofUrl: text("proof_url"), // public post/page showing the wallet, never fetched server-side
    status: text("status").notNull().default("pending"), // pending | verified | revoked
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.wallet] }), index("project_reps_wallet").on(t.wallet)],
);

/**
 * A market proposal moving through review. `metadata` is the exact structured rules (schema v1)
 * and `metadataHash` its canonical keccak256; the on-chain approval later binds that hash.
 * Status: draft | submitted | under_review | changes_requested | approved | rejected | scheduled | published | withdrawn
 */
export const marketProposals = pgTable(
  "market_proposals",
  {
    id: text("id").primaryKey(),
    author: text("author").notNull(),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    status: text("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    metadata: jsonb("metadata").notNull(),
    metadataHash: text("metadata_hash").notNull(),
    closeTime: timestamp("close_time", { withTimezone: true }).notNull(),
    launchWindow: text("launch_window").notNull().default(""),
    resolver: text("resolver"),
    /** Approved creator who will publish (set by the curator). Defaults to the author when null. */
    publisher: text("publisher"),
    liquidityPlan: text("liquidity_plan").notNull().default(""),
    conflicts: text("conflicts").notNull().default(""),
    rationale: text("rationale").notNull().default(""),
    references_: jsonb("references").notNull().default([]),
    sponsored: boolean("sponsored").notNull().default(false),
    assignedCurator: text("assigned_curator"),
    /** Signed approval, present once status = approved/scheduled/published. */
    approval: jsonb("approval"),
    marketId: integer("market_id"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("proposals_status").on(t.status),
    index("proposals_author").on(t.author),
    index("proposals_hash").on(t.metadataHash),
    uniqueIndex("proposals_market").on(t.marketId),
  ],
);

/** Every review action, append-only. The public sees decisions and reasons; internal notes stay private. */
export const proposalReviews = pgTable(
  "proposal_reviews",
  {
    id: serial("id").primaryKey(),
    proposalId: text("proposal_id")
      .notNull()
      .references(() => marketProposals.id, { onDelete: "cascade" }),
    proposalVersion: integer("proposal_version").notNull(),
    reviewer: text("reviewer").notNull(),
    action: text("action").notNull(), // claim | approve | reject | request_changes | note | unassign | withdraw | resubmit | publish
    reason: text("reason").notNull().default(""),
    checklist: jsonb("checklist"),
    duplicateOf: text("duplicate_of"),
    internal: boolean("internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reviews_proposal").on(t.proposalId, t.createdAt)],
);

/** Administrative and curation audit log (append-only). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    details: jsonb("details"),
    signature: text("signature"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_subject").on(t.subjectType, t.subjectId), index("audit_actor").on(t.actor)],
);

/** Per-wallet preferences. No personal data. */
export const userSettings = pgTable("user_settings", {
  wallet: text("wallet").primaryKey(),
  displayName: text("display_name"),
  notifyProposals: boolean("notify_proposals").notNull().default(true),
  notifyResolution: boolean("notify_resolution").notNull().default(true),
  notifyClaims: boolean("notify_claims").notNull().default(true),
  numberFormat: text("number_format").notNull().default("compact"),
  hideBalances: boolean("hide_balances").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Wallet-signed session nonces (challenge/response), short-lived. */
export const authNonces = pgTable("auth_nonces", {
  nonce: text("nonce").primaryKey(),
  wallet: text("wallet").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
});
