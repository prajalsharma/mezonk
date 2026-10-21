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
import { sql } from "drizzle-orm";

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
    /** Taker fee of the market's policy (makers pay none). */
    feeBps: integer("fee_bps").notNull(),
    /** v1 AMM only. */
    protocolFeeShareBps: integer("protocol_fee_share_bps"),
    /** Graduation/fee policy the market was published under (immutable on-chain). */
    policyId: integer("policy_id"),
    seedingDeadline: timestamp("seeding_deadline", { withTimezone: true }),
    graduatedAt: timestamp("graduated_at", { withTimezone: true }),
    /** Best escrowed (on-chain) YES bid / ask in cents; null when that side is empty. */
    bestBid: integer("best_bid"),
    bestAsk: integer("best_ask"),
    /** Collateral locked in open escrowed buy orders. */
    escrowed: amount("escrowed").notNull().default("0"),
    seedOrderCount: integer("seed_order_count").notNull().default(0),
    seederCount: integer("seeder_count").notNull().default(0),
    proposalWindow: integer("proposal_window").notNull(),
    challengeWindow: integer("challenge_window").notNull(),
    arbitrationWindow: integer("arbitration_window").notNull(),
    proposerBond: amount("proposer_bond").notNull(),
    disputeBond: amount("dispute_bond").notNull(),
    /** v1 AMM only. */
    initialLiquidity: amount("initial_liquidity"),
    initialYesProbBps: integer("initial_yes_prob_bps"),
    poolYes: amount("pool_yes"),
    poolNo: amount("pool_no"),
    collateral: amount("collateral").notNull(),
    /** YES price of the last real fill (0..1). Null until the first trade: never a made-up price. */
    priceYes: doublePrecision("price_yes"),
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
    poolYes: amount("pool_yes"),
    poolNo: amount("pool_no"),
    /** Average YES-equivalent price of this trade (0..1). */
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

// ───────────────────────────── Order book ─────────────────────────────

/**
 * Off-chain signed orders (EIP-712). The signature authorizes a fill up to `quantity` at `price`; it never
 * moves funds by itself. Status is advisory for the book: the contract re-checks everything at settlement.
 * open | filled | cancelled (on-chain) | expired | stale (maker lacks funds/approval) | removed (hidden by maker)
 */
export const orders = pgTable(
  "orders",
  {
    hash: text("hash").primaryKey(),
    chainId: integer("chain_id").notNull(),
    exchange: text("exchange").notNull(),
    marketId: integer("market_id").notNull(),
    maker: text("maker").notNull(),
    taker: text("taker").notNull(),
    outcome: integer("outcome").notNull(), // 0 YES, 1 NO
    side: integer("side").notNull(), // 0 buy, 1 sell
    price: integer("price").notNull(), // cents 1..99
    quantity: amount("quantity").notNull(),
    filled: amount("filled").notNull().default("0"),
    expiry: timestamp("expiry", { withTimezone: true }).notNull(),
    nonce: amount("nonce").notNull(),
    salt: amount("salt").notNull(),
    signature: text("signature").notNull(),
    status: text("status").notNull().default("open"),
    statusReason: text("status_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_book").on(t.marketId, t.status, t.outcome, t.side, t.price),
    index("orders_maker").on(t.maker, t.status),
  ],
);

/** Escrowed on-chain orders (seed commitments before graduation), rebuilt from events. */
export const restingOrders = pgTable(
  "resting_orders",
  {
    orderId: integer("order_id").primaryKey(),
    marketId: integer("market_id").notNull(),
    maker: text("maker").notNull(),
    outcome: integer("outcome").notNull(),
    side: integer("side").notNull(),
    price: integer("price").notNull(),
    quantity: amount("quantity").notNull(),
    remaining: amount("remaining").notNull(),
    seed: boolean("seed").notNull(),
    /** open | filled | cancelled (cancelled after a failed seeding = refunded) */
    status: text("status").notNull(),
    placedAt: timestamp("placed_at", { withTimezone: true }).notNull(),
    placedTx: text("placed_tx").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedTx: text("closed_tx"),
  },
  (t) => [index("resting_market").on(t.marketId, t.status), index("resting_maker").on(t.maker)],
);

/** One row per on-chain Fill event (maker-level). The only source for prices and trade history. */
export const fills = pgTable(
  "fills",
  {
    eventId: integer("event_id")
      .primaryKey()
      .references(() => chainEvents.id, { onDelete: "cascade" }),
    marketId: integer("market_id").notNull(),
    orderRef: text("order_ref").notNull(),
    resting: boolean("resting").notNull(),
    maker: text("maker").notNull(),
    taker: text("taker").notNull(),
    makerOutcome: integer("maker_outcome").notNull(),
    makerSide: integer("maker_side").notNull(),
    makerPrice: integer("maker_price").notNull(),
    quantity: amount("quantity").notNull(),
    complement: boolean("complement").notNull(),
    takerFee: amount("taker_fee").notNull(),
    /** YES price in cents implied by this fill. */
    yesPrice: integer("yes_price").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    txHash: text("tx_hash").notNull(),
  },
  (t) => [index("fills_market_time").on(t.marketId, t.blockTime), index("fills_maker").on(t.maker), index("fills_taker").on(t.taker)],
);

/** The verified graduation snapshot, from the on-chain Graduated event. */
export const marketGraduations = pgTable("market_graduations", {
  marketId: integer("market_id").primaryKey(),
  policyId: integer("policy_id").notNull(),
  bestBid: integer("best_bid").notNull(),
  bestAsk: integer("best_ask").notNull(),
  bidDepth: amount("bid_depth").notNull(),
  askDepth: amount("ask_depth").notNull(),
  seeders: integer("seeders").notNull(),
  blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
  txHash: text("tx_hash").notNull(),
});

/** On-chain policy versions (PolicyAdded / PolicyActiveSet). Immutable once added. */
export const policies = pgTable("policies", {
  policyId: integer("policy_id").primaryKey(),
  params: jsonb("params").notNull(),
  active: boolean("active").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  txHash: text("tx_hash").notNull(),
});

/** Incentive accruals and claims (rebates, referrals), from MezonkIncentives events. Amounts actually moved. */
export const incentiveLedger = pgTable(
  "incentive_ledger",
  {
    eventId: integer("event_id")
      .primaryKey()
      .references(() => chainEvents.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // rebate_accrued | rebate_claimed | rebates_swept | referral_accrued | referral_claimed | referrer_set
    marketId: integer("market_id"),
    account: text("account"),
    counterparty: text("counterparty"),
    amount: amount("amount").notNull().default("0"),
    blockTime: timestamp("block_time", { withTimezone: true }).notNull(),
    txHash: text("tx_hash").notNull(),
  },
  (t) => [index("incentive_account").on(t.account, t.kind), index("incentive_market").on(t.marketId)],
);

/** Durable one-shot flags (e.g. the admin bootstrap). A row's existence is the flag; inserts are atomic. */
export const platformFlags = pgTable("platform_flags", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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
    /** Short off-chain summary shown on cards and the market page (not part of the hashed rules). */
    summary: text("summary").notNull().default(""),
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

// ───────────────────────── Platform identity, RBAC, media, discussion ─────────────────────────

/** Server-side wallet sessions. The cookie holds a random token; only its SHA-256 is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(), // sha256(token), hex
    wallet: text("wallet").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedReason: text("revoked_reason"),
  },
  (t) => [index("sessions_wallet").on(t.wallet)],
);

/** Per-wallet account status. Absent row = active. */
export const accounts = pgTable("accounts", {
  wallet: text("wallet").primaryKey(),
  status: text("status").notNull().default("active"), // active | suspended
  statusReason: text("status_reason"),
  statusBy: text("status_by"),
  statusAt: timestamp("status_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Uploaded images. Bytes live in object storage; this is metadata and ownership. */
export const media = pgTable(
  "media",
  {
    id: text("id").primaryKey(),
    owner: text("owner").notNull(),
    kind: text("kind").notNull(), // avatar | cover | context
    status: text("status").notNull().default("pending"), // pending | attached | removed
    provider: text("provider").notNull(),
    storageKey: text("storage_key").notNull(),
    url: text("url").notNull(),
    mime: text("mime").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    attachedAt: timestamp("attached_at", { withTimezone: true }),
  },
  (t) => [index("media_owner").on(t.owner), index("media_status").on(t.status, t.createdAt)],
);

/** Public identity for a wallet. The wallet is the identity; the username is a mutable, unique handle. */
export const profiles = pgTable(
  "profiles",
  {
    wallet: text("wallet").primaryKey(),
    username: text("username").notNull(),
    usernameNormalized: text("username_normalized").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio").notNull().default(""),
    avatarMediaId: text("avatar_media_id").references(() => media.id, { onDelete: "set null" }),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("profiles_username").on(t.usernameNormalized)],
);

/** Platform (off-chain) role assignments. Never deleted: revocation sets revoked_at. */
export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: serial("id").primaryKey(),
    wallet: text("wallet").notNull(),
    role: text("role").notNull(), // ADMINISTRATOR
    grantedBy: text("granted_by").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    reason: text("reason").notNull().default(""),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: text("revoked_by"),
    revokeReason: text("revoke_reason"),
  },
  (t) => [
    uniqueIndex("role_assignments_active").on(t.wallet, t.role).where(sql`${t.revokedAt} is null`),
    index("role_assignments_wallet").on(t.wallet),
  ],
);

/** On-chain role changes (setCreator / setCurator) requested in the admin UI and their real transactions. */
export const roleOperations = pgTable(
  "role_operations",
  {
    id: text("id").primaryKey(),
    fn: text("fn").notNull(), // setCreator | setCurator (factory) | addPolicy | setPolicyActive (exchange)
    target: text("target").notNull(),
    grant: boolean("grant").notNull(),
    /** addPolicy: the policy struct (decimal strings); setPolicyActive: { policyId }. */
    params: jsonb("params"),
    requestedBy: text("requested_by").notNull(),
    reason: text("reason").notNull().default(""),
    status: text("status").notNull().default("awaiting_signature"), // awaiting_signature | submitted | confirmed | failed
    txHash: text("tx_hash"),
    error: text("error"),
    confirmedBlock: bigint("confirmed_block", { mode: "bigint" }),
    incidentId: text("incident_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("role_operations_tx").on(t.txHash), index("role_operations_target").on(t.target)],
);

/** Compromised-wallet incidents: what was replaced, by whom, and the resulting report. Append-only. */
export const walletReplacements = pgTable("wallet_replacements", {
  id: text("id").primaryKey(),
  oldWallet: text("old_wallet").notNull(),
  newWallet: text("new_wallet").notNull(),
  performedBy: text("performed_by").notNull(),
  reason: text("reason").notNull(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Images attached to a proposal; shown on the published market through the proposal↔market link. */
export const proposalMedia = pgTable(
  "proposal_media",
  {
    proposalId: text("proposal_id")
      .notNull()
      .references(() => marketProposals.id, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references(() => media.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // cover | context
    position: integer("position").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.mediaId] })],
);

/** Public URL slugs. Immutable once assigned; the market id stays the canonical identifier. */
export const marketSlugs = pgTable(
  "market_slugs",
  {
    slug: text("slug").primaryKey(),
    marketId: integer("market_id")
      .notNull()
      .references(() => markets.marketId, { onDelete: "cascade" }),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("market_slugs_current").on(t.marketId).where(sql`${t.isCurrent}`)],
);

/** Discussion under a market. Bound to the numeric market id, never to the slug. */
export const comments = pgTable(
  "comments",
  {
    id: serial("id").primaryKey(),
    marketId: integer("market_id")
      .notNull()
      .references(() => markets.marketId, { onDelete: "cascade" }),
    author: text("author").notNull(),
    body: text("body").notNull(),
    status: text("status").notNull().default("visible"), // visible | hidden | deleted
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    moderatedBy: text("moderated_by"),
    moderationReason: text("moderation_reason"),
  },
  (t) => [index("comments_market").on(t.marketId, t.id), index("comments_author").on(t.author)],
);

export const commentReports = pgTable(
  "comment_reports",
  {
    id: serial("id").primaryKey(),
    commentId: integer("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    reporter: text("reporter").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
  },
  (t) => [uniqueIndex("comment_reports_once").on(t.commentId, t.reporter)],
);
