/**
 * Single source of truth for "who can do what, right now" on a market. Pure and unit-tested.
 * It mirrors MezonkMarkets' checks so the UI only offers actions the contract will accept, and
 * explains why everything else is unavailable. It is NOT a security boundary: the contract
 * enforces every permission; this only decides what to show.
 */

export const CHAIN_STAGE = { Open: 0, Closed: 1, Proposed: 2, Disputed: 3, Finalized: 4 } as const;

export type Role =
  | "visitor"
  | "participant"
  | "holder"
  | "resolver"
  | "creator"
  | "challenger"
  | "arbitrator"
  | "finalizer"
  | "claimant"
  | "bond-holder"
  | "admin";

export interface Availability {
  available: boolean;
  reason: string;
  /** True when connecting a wallet (on the right network) would be the next step. */
  needsWallet?: boolean;
  /** Seconds left in the window that allows this action, when relevant. */
  secondsLeft?: number;
}

export interface MarketState {
  creator: string;
  resolver: string;
  arbitrator: string;
  disputer: string;
  closeTime: bigint;
  proposedAt: bigint;
  disputedAt: bigint;
  proposalWindow: number;
  challengeWindow: number;
  arbitrationWindow: number;
  proposedOutcome: number;
  finalOutcome: number;
  finalized: boolean;
  liquidityClaimed: boolean;
  creatorFees: bigint;
  proposerBond: bigint;
  disputeBond: bigint;
  poolYes: bigint;
  poolNo: bigint;
}

export interface PermissionInput {
  account?: string;
  onRightChain: boolean;
  /** Latest block timestamp in seconds (chain time, not the browser clock). */
  chainNow: bigint;
  stage: number;
  market: MarketState;
  yes: bigint;
  no: bigint;
  claimable: bigint;
  bondCredits: bigint;
  musdBalance?: bigint;
  isOwner?: boolean;
}

export interface Permissions {
  roles: Role[];
  propose: Availability;
  dispute: Availability;
  arbitrate: Availability;
  finalize: Availability & { outcome?: number; why?: string };
  redeem: Availability & { payout: bigint; kind: "payout" | "refund" | "none" };
  claimLiquidity: Availability & { payout: bigint };
  claimFees: Availability & { amount: bigint };
  withdrawBond: Availability & { amount: bigint };
}

const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const no = (reason: string, extra: Partial<Availability> = {}): Availability => ({ available: false, reason, ...extra });

export function payoutFor(outcome: number, yes: bigint, noShares: bigint): bigint {
  if (outcome === 1) return yes;
  if (outcome === 2) return noShares;
  if (outcome === 3) return (yes + noShares) / 2n;
  return 0n;
}

export function permissions(i: PermissionInput): Permissions {
  const m = i.market;
  const me = i.account;
  const connected = !!me;
  const ready = connected && i.onRightChain;
  const wallet = (r: string) => no(connected ? "Switch your wallet to the Mezo network." : r, { needsWallet: true });

  const isResolver = eq(me, m.resolver);
  const isArbitrator = eq(me, m.arbitrator);
  const isCreator = eq(me, m.creator);
  const holds = i.yes + i.no > 0n;

  const roles: Role[] = [];
  if (!connected) roles.push("visitor");
  else roles.push("participant");
  if (holds) roles.push("holder");
  if (isResolver) roles.push("resolver");
  if (isCreator) roles.push("creator");
  if (isArbitrator) roles.push("arbitrator");
  if (i.isOwner) roles.push("admin");

  const now = i.chainNow;
  const proposalEnd = m.closeTime + BigInt(m.proposalWindow);
  const challengeEnd = m.proposedAt + BigInt(m.challengeWindow);
  const arbitrationEnd = m.disputedAt + BigInt(m.arbitrationWindow);
  const left = (end: bigint) => Number(end > now ? end - now : 0n);

  // Propose
  let propose: Availability;
  if (i.stage === CHAIN_STAGE.Open) propose = no("Outcomes can be proposed only after trading closes.");
  else if (i.stage !== CHAIN_STAGE.Closed) propose = no("An outcome has already been proposed.");
  else if (now >= proposalEnd) propose = no("The proposal window has closed. This market settles as Invalid.");
  else if (!connected) propose = wallet("Only this market's resolver can propose. Connect the resolver wallet.");
  else if (!isResolver) propose = no("Only this market's designated resolver can propose an outcome.");
  else if (!i.onRightChain) propose = wallet("");
  else if (i.musdBalance !== undefined && i.musdBalance < m.proposerBond)
    propose = no("You need enough MUSD to post the proposal bond.", { secondsLeft: left(proposalEnd) });
  else propose = { available: true, reason: "You are the resolver and the proposal window is open.", secondsLeft: left(proposalEnd) };

  // Dispute
  let dispute: Availability;
  if (i.stage !== CHAIN_STAGE.Proposed)
    dispute = no(
      i.stage === CHAIN_STAGE.Disputed
        ? "This proposal has already been challenged. Only one challenge is allowed."
        : i.stage === CHAIN_STAGE.Finalized
          ? "The outcome is final."
          : "There is no proposal to challenge yet.",
    );
  else if (now >= challengeEnd) dispute = no("The challenge window has closed.");
  else if (!connected) dispute = wallet("Connect a wallet to challenge this proposal.");
  else if (isResolver) dispute = no("The resolver cannot challenge its own proposal.");
  else if (!i.onRightChain) dispute = wallet("");
  else if (i.musdBalance !== undefined && i.musdBalance < m.disputeBond)
    dispute = no("You need enough MUSD to post the challenge bond.", { secondsLeft: left(challengeEnd) });
  else dispute = { available: true, reason: "The challenge window is open.", secondsLeft: left(challengeEnd) };
  if (dispute.available || (i.stage === CHAIN_STAGE.Proposed && now < challengeEnd && connected && !isResolver))
    roles.push("challenger");

  // Arbitrate
  let arbitrate: Availability;
  if (!isArbitrator) arbitrate = no("Only this market's arbitrator can rule on a challenge.");
  else if (i.stage !== CHAIN_STAGE.Disputed) arbitrate = no("There is no open challenge to rule on.");
  else if (now >= arbitrationEnd) arbitrate = no("The arbitration deadline has passed. The market settles as Invalid.");
  else if (!i.onRightChain) arbitrate = wallet("");
  else arbitrate = { available: true, reason: "A challenge is awaiting your ruling.", secondsLeft: left(arbitrationEnd) };

  // Finalize (permissionless once a deadline passes)
  let finalize: Permissions["finalize"];
  const fin = (outcome: number, why: string, end: bigint, waiting: string) =>
    now >= end
      ? ready
        ? { available: true, reason: why, outcome, why }
        : { ...wallet("Anyone can finalize now. Connect a wallet to send the transaction."), outcome, why }
      : { ...no(waiting, { secondsLeft: left(end) }), outcome, why };
  if (i.stage === CHAIN_STAGE.Proposed)
    finalize = fin(m.proposedOutcome, "The challenge window ended with no challenge.", challengeEnd, "The challenge window is still open.");
  else if (i.stage === CHAIN_STAGE.Closed)
    finalize = fin(3, "No outcome was proposed before the deadline, so the market settles as Invalid.", proposalEnd, "The resolver can still propose an outcome.");
  else if (i.stage === CHAIN_STAGE.Disputed)
    finalize = fin(3, "The arbitrator missed the deadline, so the market settles as Invalid and both bonds are refunded.", arbitrationEnd, "Waiting for the arbitrator's ruling.");
  else if (i.stage === CHAIN_STAGE.Finalized) finalize = no("Already finalized.");
  else finalize = no("Trading is still open.");
  if (finalize.available) roles.push("finalizer");

  // Redeem
  const kind = m.finalOutcome === 3 ? "refund" : "payout";
  let redeem: Permissions["redeem"];
  if (!m.finalized) redeem = { ...no("Claims open once the outcome is final."), payout: 0n, kind: "none" };
  else if (!connected) redeem = { ...wallet("Connect your wallet to see whether you have a claim."), payout: 0n, kind };
  else if (!holds) redeem = { ...no("This wallet holds no shares in this market."), payout: 0n, kind: "none" };
  else if (i.claimable === 0n)
    redeem = { ...no("Your shares are on the losing side, so there is nothing to claim."), payout: 0n, kind: "none" };
  else if (!i.onRightChain) redeem = { ...wallet(""), payout: i.claimable, kind };
  else redeem = { available: true, reason: kind === "refund" ? "Refund available." : "Payout available.", payout: i.claimable, kind };
  if (redeem.payout > 0n) roles.push("claimant");

  // Creator liquidity and fees
  const lp = m.finalized ? payoutFor(m.finalOutcome, m.poolYes, m.poolNo) : 0n;
  let claimLiquidity: Permissions["claimLiquidity"];
  if (!isCreator) claimLiquidity = { ...no("Only the market creator can withdraw pool liquidity."), payout: 0n };
  else if (!m.finalized) claimLiquidity = { ...no("Pool liquidity unlocks once the outcome is final."), payout: 0n };
  else if (m.liquidityClaimed) claimLiquidity = { ...no("Pool liquidity was already withdrawn."), payout: 0n };
  else if (!i.onRightChain) claimLiquidity = { ...wallet(""), payout: lp };
  else claimLiquidity = { available: true, reason: "Pool liquidity is ready to withdraw.", payout: lp };

  let claimFees: Permissions["claimFees"];
  if (!isCreator) claimFees = { ...no("Only the creator earns the creator share of fees."), amount: 0n };
  else if (m.creatorFees === 0n) claimFees = { ...no("No unclaimed fees."), amount: 0n };
  else if (!i.onRightChain) claimFees = { ...wallet(""), amount: m.creatorFees };
  else claimFees = { available: true, reason: "Fees can be claimed at any time.", amount: m.creatorFees };

  let withdrawBond: Permissions["withdrawBond"];
  if (i.bondCredits === 0n) withdrawBond = { ...no("No bonds to withdraw."), amount: 0n };
  else if (!i.onRightChain) withdrawBond = { ...wallet(""), amount: i.bondCredits };
  else withdrawBond = { available: true, reason: "Returned or won bonds are ready.", amount: i.bondCredits };
  if (i.bondCredits > 0n) roles.push("bond-holder");

  return { roles, propose, dispute, arbitrate, finalize, redeem, claimLiquidity, claimFees, withdrawBond };
}
