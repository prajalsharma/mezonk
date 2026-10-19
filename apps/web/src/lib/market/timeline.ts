import { FINALIZE_REASON, OUTCOME, outcomeLabel } from "./stage";

/**
 * Reconstructs a market's public resolution timeline from indexed chain events plus the market's
 * own contract parameters. Two kinds of entry, always labelled:
 *  - "chain": an emitted event with a transaction hash. Verifiable on the explorer.
 *  - "derived": a moment implied by contract parameters (e.g. trading closes at closeTime).
 *    These have no transaction; they are computed, never fabricated as events.
 */

export interface TimelineEventInput {
  eventName: string;
  blockTime: string | Date;
  txHash: string;
  actor: string | null;
  args: Record<string, unknown>;
}

export interface TimelineMarketInput {
  createdAt: string | Date;
  createdTx: string;
  creator: string;
  closeTime: string | Date;
  proposalWindow: number;
  challengeWindow: number;
  arbitrationWindow: number;
}

export type EntryKind =
  | "created"
  | "closed"
  | "proposal-deadline"
  | "proposed"
  | "challenge-window"
  | "disputed"
  | "arbitration-window"
  | "arbitrated"
  | "finalized"
  | "claims-open"
  | "redeemed"
  | "liquidity"
  | "bond";

export interface TimelineEntry {
  kind: EntryKind;
  title: string;
  detail?: string;
  at: string;
  source: "chain" | "derived";
  /** done: happened. pending: deadline in the future. lapsed: deadline passed without the action. */
  status: "done" | "pending" | "lapsed";
  actor?: string;
  txHash?: string;
  evidence?: { hash: string; uri: string };
  outcome?: number;
  /** For window entries: when the window closes. */
  deadline?: string;
}

const iso = (d: string | Date | number) => new Date(d).toISOString();
const ms = (d: string | Date) => new Date(d).getTime();

export function buildTimeline(
  m: TimelineMarketInput,
  events: TimelineEventInput[],
  now: number,
): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  const evs = [...events].sort((a, b) => ms(a.blockTime) - ms(b.blockTime));
  const find = (n: string) => evs.find((e) => e.eventName === n);
  const proposed = find("OutcomeProposed");
  const disputed = find("OutcomeDisputed");
  const arbitrated = find("DisputeArbitrated");
  const finalized = find("MarketFinalized");
  const close = ms(m.closeTime);
  const finalAt = finalized ? ms(finalized.blockTime) : Infinity;

  out.push({
    kind: "created",
    title: "Market created, rules committed",
    detail: "The question, rules and sources were hashed and stored on-chain. They cannot be edited.",
    at: iso(m.createdAt),
    source: "chain",
    status: "done",
    actor: m.creator,
    txHash: m.createdTx,
  });

  out.push({
    kind: "closed",
    title: now >= close ? "Trading closed" : "Trading closes",
    detail: "Set at creation. Closing does not decide the outcome.",
    at: iso(m.closeTime),
    source: "derived",
    status: now >= close ? "done" : "pending",
  });

  const proposalDeadline = close + m.proposalWindow * 1000;
  if (!proposed) {
    if (now >= close) {
      const lapsed = now >= proposalDeadline;
      out.push({
        kind: "proposal-deadline",
        title: lapsed ? "No outcome proposed in time" : "Resolver must propose by",
        detail: lapsed
          ? "Under the contract rules this market settles as Invalid. Anyone can finalize it."
          : "If the resolver proposes nothing by this time, the market settles as Invalid.",
        at: iso(proposalDeadline),
        source: "derived",
        status: lapsed ? (finalized ? "done" : "lapsed") : "pending",
      });
    }
  } else {
    const pa = proposed.args;
    out.push({
      kind: "proposed",
      title: `Outcome proposed: ${outcomeLabel(Number(pa.outcome))}`,
      at: iso(proposed.blockTime),
      source: "chain",
      status: "done",
      actor: proposed.actor ?? undefined,
      txHash: proposed.txHash,
      outcome: Number(pa.outcome),
      evidence: { hash: String(pa.evidenceHash), uri: String(pa.evidenceURI ?? "") },
    });
    const challengeEnd = Number(pa.challengeDeadline) * 1000;
    out.push({
      kind: "challenge-window",
      title: "Challenge window opened",
      detail: disputed
        ? "A challenge was filed before the deadline."
        : now >= challengeEnd
          ? "Closed with no challenge. The proposal can be finalized."
          : "Anyone except the resolver can challenge by posting a bond.",
      at: iso(proposed.blockTime),
      deadline: iso(new Date(challengeEnd)),
      source: "derived",
      status: disputed || now >= challengeEnd ? "done" : "pending",
    });
  }

  if (disputed) {
    const da = disputed.args;
    out.push({
      kind: "disputed",
      title: "Proposal challenged",
      at: iso(disputed.blockTime),
      source: "chain",
      status: "done",
      actor: disputed.actor ?? undefined,
      txHash: disputed.txHash,
      evidence: { hash: String(da.evidenceHash), uri: String(da.evidenceURI ?? "") },
    });
    const arbEnd = Number(da.arbitrationDeadline) * 1000;
    out.push({
      kind: "arbitration-window",
      title: arbitrated ? "Arbitration opened" : now >= arbEnd ? "Arbitrator missed the deadline" : "Arbitration open",
      detail: arbitrated
        ? "The arbitrator ruled before the deadline."
        : now >= arbEnd
          ? "Under the contract rules this market settles as Invalid and both bonds are refunded."
          : "If no ruling arrives by the deadline, the market settles as Invalid and both bonds are refunded.",
      at: iso(disputed.blockTime),
      deadline: iso(new Date(arbEnd)),
      source: "derived",
      status: arbitrated ? "done" : now >= arbEnd ? (finalized ? "done" : "lapsed") : "pending",
    });
  }

  if (arbitrated) {
    const aa = arbitrated.args;
    out.push({
      kind: "arbitrated",
      title: `Arbitrator ruled ${outcomeLabel(Number(aa.outcome))}`,
      at: iso(arbitrated.blockTime),
      source: "chain",
      status: "done",
      actor: arbitrated.actor ?? undefined,
      txHash: arbitrated.txHash,
      outcome: Number(aa.outcome),
      evidence: aa.rationaleHash ? { hash: String(aa.rationaleHash), uri: String(aa.rationaleURI ?? "") } : undefined,
    });
  }

  if (finalized) {
    const fa = finalized.args;
    const o = Number(fa.outcome);
    out.push({
      kind: "finalized",
      title: `Final outcome: ${outcomeLabel(o)}`,
      detail: FINALIZE_REASON[Number(fa.reason)],
      at: iso(finalized.blockTime),
      source: "chain",
      status: "done",
      actor: finalized.actor ?? undefined,
      txHash: finalized.txHash,
      outcome: o,
    });
    out.push({
      kind: "claims-open",
      title: o === OUTCOME.Invalid ? "Refunds open" : "Payouts open",
      detail:
        o === OUTCOME.Invalid
          ? "Every Yes and No share redeems for 0.5 MUSD. No deadline."
          : `Each ${outcomeLabel(o)} share redeems for 1 MUSD. No deadline.`,
      at: iso(finalized.blockTime),
      source: "derived",
      status: "done",
    });
  }

  for (const e of evs) {
    if (ms(e.blockTime) < finalAt && e.eventName !== "BondCredited") continue;
    const a = e.args;
    if (e.eventName === "Redeemed") {
      out.push({
        kind: "redeemed",
        title: "Position redeemed",
        detail: `${fmt(a.payout)} MUSD paid`,
        at: iso(e.blockTime),
        source: "chain",
        status: "done",
        actor: e.actor ?? undefined,
        txHash: e.txHash,
      });
    } else if (e.eventName === "LiquidityClaimed") {
      out.push({
        kind: "liquidity",
        title: "Creator withdrew pool liquidity",
        detail: `${fmt(a.payout)} MUSD`,
        at: iso(e.blockTime),
        source: "chain",
        status: "done",
        actor: e.actor ?? undefined,
        txHash: e.txHash,
      });
    } else if (e.eventName === "BondCredited") {
      out.push({
        kind: "bond",
        title: "Bond credited",
        detail: `${fmt(a.amount)} MUSD to ${String(a.account).slice(0, 8)}…`,
        at: iso(e.blockTime),
        source: "chain",
        status: "done",
        actor: String(a.account).toLowerCase(),
        txHash: e.txHash,
      });
    }
  }

  // Stable chronological order; derived pending deadlines sort by their time too.
  return out.sort((a, b) => ms(a.at) - ms(b.at) || order(a.kind) - order(b.kind));
}

const ORDER: EntryKind[] = [
  "created",
  "closed",
  "proposal-deadline",
  "proposed",
  "challenge-window",
  "disputed",
  "arbitration-window",
  "arbitrated",
  "bond",
  "finalized",
  "claims-open",
  "redeemed",
  "liquidity",
];
const order = (k: EntryKind) => ORDER.indexOf(k);

function fmt(v: unknown) {
  const n = Number(BigInt(String(v ?? "0")) / 10n ** 14n) / 1e4;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}
