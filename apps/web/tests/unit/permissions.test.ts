import { describe, expect, it } from "vitest";
import { CHAIN_STAGE, permissions, type PermissionInput } from "@/lib/market/permissions";

// Test doubles: hand-built market states. No chain involved.
const R = "0x00000000000000000000000000000000000000aa";
const A = "0x00000000000000000000000000000000000000bb";
const C = "0x00000000000000000000000000000000000000cc";
const U = "0x00000000000000000000000000000000000000dd";
const E = 10n ** 18n;

const base = (over: Partial<PermissionInput> = {}, m: Partial<PermissionInput["market"]> = {}): PermissionInput => ({
  account: U,
  onRightChain: true,
  chainNow: 1_000n,
  stage: CHAIN_STAGE.Open,
  yes: 0n,
  no: 0n,
  claimable: 0n,
  bondCredits: 0n,
  musdBalance: 1000n * E,
  ...over,
  market: {
    creator: C,
    resolver: R,
    arbitrator: A,
    disputer: "0x0000000000000000000000000000000000000000",
    closeTime: 1_000n,
    proposedAt: 0n,
    disputedAt: 0n,
    proposalWindow: 100,
    challengeWindow: 50,
    arbitrationWindow: 200,
    proposedOutcome: 0,
    finalOutcome: 0,
    finalized: false,
    liquidityClaimed: false,
    creatorFees: 0n,
    proposerBond: 25n * E,
    disputeBond: 25n * E,
    poolYes: 80n * E,
    poolNo: 120n * E,
    ...m,
  },
});

describe("permissions", () => {
  it("disconnected visitor can read but every action asks for a wallet or explains why not", () => {
    const p = permissions(base({ account: undefined, stage: CHAIN_STAGE.Closed, chainNow: 1_010n }));
    expect(p.roles).toEqual(["visitor"]);
    expect(p.propose).toMatchObject({ available: false, needsWallet: true });
    expect(p.arbitrate.available).toBe(false);
    expect(p.redeem.available).toBe(false);
  });

  it("eligible proposer: resolver, closed, inside the window", () => {
    const p = permissions(base({ account: R, stage: CHAIN_STAGE.Closed, chainNow: 1_050n }));
    expect(p.roles).toContain("resolver");
    expect(p.propose).toMatchObject({ available: true, secondsLeft: 50 });
  });

  it("ineligible proposer: non-resolver, trading open, or window lapsed", () => {
    expect(permissions(base({ stage: CHAIN_STAGE.Closed, chainNow: 1_050n })).propose.reason).toMatch(/designated resolver/);
    expect(permissions(base({ account: R })).propose.reason).toMatch(/after trading closes/);
    expect(permissions(base({ account: R, stage: CHAIN_STAGE.Closed, chainNow: 1_100n })).propose.reason).toMatch(/window has closed/);
    expect(permissions(base({ account: R, stage: CHAIN_STAGE.Closed, chainNow: 1_050n, musdBalance: 0n })).propose.available).toBe(false);
  });

  it("eligible challenger during the window; resolver and late callers cannot", () => {
    const st = { stage: CHAIN_STAGE.Proposed, chainNow: 1_120n };
    const m = { proposedAt: 1_100n, proposedOutcome: 1 };
    const p = permissions(base(st, m));
    expect(p.dispute.available).toBe(true);
    expect(p.roles).toContain("challenger");
    expect(permissions(base({ ...st, account: R }, m)).dispute.reason).toMatch(/own proposal/);
    expect(permissions(base({ ...st, chainNow: 1_150n }, m)).dispute.reason).toMatch(/window has closed/);
    expect(permissions(base({ stage: CHAIN_STAGE.Disputed }, m)).dispute.reason).toMatch(/already been challenged/);
  });

  it("unauthorized vs authorized arbitrator", () => {
    const st = { stage: CHAIN_STAGE.Disputed, chainNow: 1_200n };
    const m = { proposedAt: 1_100n, disputedAt: 1_110n };
    expect(permissions(base(st, m)).arbitrate.available).toBe(false);
    expect(permissions(base({ ...st, account: R }, m)).arbitrate.available).toBe(false);
    const p = permissions(base({ ...st, account: A }, m));
    expect(p.arbitrate.available).toBe(true);
    expect(p.roles).toContain("arbitrator");
    expect(permissions(base({ ...st, account: A, chainNow: 1_310n }, m)).arbitrate.available).toBe(false);
  });

  it("finalization unavailable then available, with the outcome it will set", () => {
    const m = { proposedAt: 1_100n, proposedOutcome: 2 };
    const early = permissions(base({ stage: CHAIN_STAGE.Proposed, chainNow: 1_149n }, m)).finalize;
    expect(early).toMatchObject({ available: false, secondsLeft: 1 });
    const ready = permissions(base({ stage: CHAIN_STAGE.Proposed, chainNow: 1_150n }, m)).finalize;
    expect(ready).toMatchObject({ available: true, outcome: 2 });
    const noProposal = permissions(base({ stage: CHAIN_STAGE.Closed, chainNow: 1_100n })).finalize;
    expect(noProposal).toMatchObject({ available: true, outcome: 3 });
    const timeout = permissions(base({ stage: CHAIN_STAGE.Disputed, chainNow: 1_310n }, { disputedAt: 1_110n })).finalize;
    expect(timeout).toMatchObject({ available: true, outcome: 3 });
    expect(permissions(base({ stage: CHAIN_STAGE.Proposed, chainNow: 1_150n, account: undefined }, m)).finalize.needsWallet).toBe(true);
  });

  it("claimable vs non-claimable wallets", () => {
    const fin = { stage: CHAIN_STAGE.Finalized };
    const m = { finalized: true, finalOutcome: 1 };
    expect(permissions(base({ ...fin, yes: 5n * E, claimable: 5n * E }, m)).redeem).toMatchObject({ available: true, kind: "payout", payout: 5n * E });
    expect(permissions(base({ ...fin, no: 5n * E, claimable: 0n }, m)).redeem.reason).toMatch(/losing side/);
    expect(permissions(base({ ...fin }, m)).redeem.reason).toMatch(/no shares/);
    expect(permissions(base({ ...fin, yes: E, no: E, claimable: E }, { finalized: true, finalOutcome: 3 })).redeem.kind).toBe("refund");
    expect(permissions(base({ stage: CHAIN_STAGE.Proposed, yes: E })).redeem.reason).toMatch(/once the outcome is final/);
  });

  it("network mismatch blocks sending but keeps the explanation", () => {
    const p = permissions(base({ account: R, onRightChain: false, stage: CHAIN_STAGE.Closed, chainNow: 1_050n }));
    expect(p.propose).toMatchObject({ available: false, needsWallet: true });
    expect(p.propose.reason).toMatch(/Switch your wallet/);
  });

  it("creator liquidity and fees, bonds", () => {
    const p = permissions(base({ account: C, stage: CHAIN_STAGE.Finalized, bondCredits: 3n }, { finalized: true, finalOutcome: 2, creatorFees: 7n }));
    expect(p.claimLiquidity).toMatchObject({ available: true, payout: 120n * E });
    expect(p.claimFees).toMatchObject({ available: true, amount: 7n });
    expect(p.withdrawBond).toMatchObject({ available: true, amount: 3n });
    expect(permissions(base({ account: C, stage: CHAIN_STAGE.Finalized }, { finalized: true, finalOutcome: 2, liquidityClaimed: true })).claimLiquidity.available).toBe(false);
  });
});
