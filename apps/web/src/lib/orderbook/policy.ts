import { z } from "zod";
import { LOT } from "./math";

/** Mirrors MezonkExchange.addPolicy bounds exactly, so the admin UI rejects what the contract would revert. */
export const POLICY_LIMITS = {
  maxFeeBps: 500,
  maxIncentiveShareBps: 8000,
  minSeedingPeriod: 3600,
  maxSeedingPeriod: 60 * 86400,
  maxMinRest: 7 * 86400,
  maxRebatePeriod: 365 * 86400,
  minClaimWindow: 7 * 86400,
  maxClaimWindow: 365 * 86400,
} as const;

const amount = z.string().regex(/^\d{1,40}$/, "whole number (wei)");

export const policySchema = z
  .object({
    minBidDepth: amount,
    minAskDepth: amount,
    minSeederNotional: amount,
    minSeeders: z.number().int().min(1).max(65535),
    maxSpread: z.number().int().min(1).max(98),
    band: z.number().int().min(0).max(98),
    seedingPeriod: z.number().int().min(POLICY_LIMITS.minSeedingPeriod).max(POLICY_LIMITS.maxSeedingPeriod),
    minRest: z.number().int().min(0).max(POLICY_LIMITS.maxMinRest),
    takerFeeBps: z.number().int().min(0).max(POLICY_LIMITS.maxFeeBps),
    rebateShareBps: z.number().int().min(0).max(10_000),
    referralShareBps: z.number().int().min(0).max(10_000),
    rebatePeriod: z.number().int().min(0).max(POLICY_LIMITS.maxRebatePeriod),
    claimWindow: z.number().int().min(POLICY_LIMITS.minClaimWindow).max(POLICY_LIMITS.maxClaimWindow),
    rebateCapPerMarket: amount,
    rebateCapPerWallet: amount,
    rebateBudget: amount,
    referralCapPerMarket: amount,
  })
  .superRefine((p, ctx) => {
    for (const k of ["minBidDepth", "minAskDepth"] as const) {
      const v = BigInt(p[k]);
      if (v === 0n || v % LOT !== 0n) ctx.addIssue({ code: "custom", path: [k], message: "must be a positive multiple of 0.01 shares" });
    }
    if (p.rebateShareBps + p.referralShareBps > POLICY_LIMITS.maxIncentiveShareBps) {
      ctx.addIssue({ code: "custom", path: ["rebateShareBps"], message: "rebates + referrals may take at most 80% of the fee (so incentives never exceed what trading pays)" });
    }
  });

export type PolicyInput = z.infer<typeof policySchema>;

/** Contract tuple form. */
export const toContractPolicy = (p: PolicyInput) => ({
  minBidDepth: BigInt(p.minBidDepth),
  minAskDepth: BigInt(p.minAskDepth),
  minSeederNotional: BigInt(p.minSeederNotional),
  minSeeders: p.minSeeders,
  maxSpread: p.maxSpread,
  band: p.band,
  seedingPeriod: p.seedingPeriod,
  minRest: p.minRest,
  takerFeeBps: p.takerFeeBps,
  rebateShareBps: p.rebateShareBps,
  referralShareBps: p.referralShareBps,
  rebatePeriod: p.rebatePeriod,
  claimWindow: p.claimWindow,
  rebateCapPerMarket: BigInt(p.rebateCapPerMarket),
  rebateCapPerWallet: BigInt(p.rebateCapPerWallet),
  rebateBudget: BigInt(p.rebateBudget),
  referralCapPerMarket: BigInt(p.referralCapPerMarket),
});
