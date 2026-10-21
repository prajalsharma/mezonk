# Incentive economics

Principle: incentives are paid only from taker fees that were actually collected, they sit in a separate contract
(`MezonkIncentives`), and they can never touch collateral, escrow or bonds. No fees, no rewards. There is no token,
emission, staking or yield.

## Where a fee goes

On each `take`, the taker fee (`notional × takerFeeBps`) is split:

```
fee ─┬─ rebatePart   = fee × rebateShareBps   (only during the rebate period, only if the market had seeders,
     │                                         capped per market and by the policy-wide budget)
     ├─ referralPart = fee_from_fills_not_against_the_referrer × referralShareBps (capped per referrer per market)
     └─ protocol     = fee − rebatePart − referralPart   (stays in the exchange as protocolFees)
```

The exchange transfers exactly `rebatePart + referralPart` to `MezonkIncentives` in the same transaction; the
incentives contract tracks `rebateReserve` and `referralReserve` and holds exactly that much MUSD (invariant-tested).

## Seeder rebates

- Eligible: wallets whose seed orders (escrowed before launch) were still open at graduation. Weight = MUSD they had
  escrowed in seed orders at launch. Weight cannot be added after launch.
- Entitlement = `rebateAccrued × weight / totalWeight`, floored, capped at `rebateCapPerWallet`. Claimable
  incrementally (`claimRebate`), never twice for the same amount.
- Accrues for `rebatePeriod` after graduation; claimable until `rebatePeriod + claimWindow`; then anyone can
  `sweepRebates`, which returns the unclaimed remainder (including amounts above per-wallet caps) to protocol fees.
- Caps: per wallet, per market (`rebateCapPerMarket`), and per policy across all its markets (`rebateBudget`). Once
  a cap is hit the excess fee stays protocol revenue; no liability is recorded.

## Referrals

- `setReferrer(r)` once, before the wallet's first trade as a taker. Not self, not someone who already named you
  (no two-way pairs). One level only: referrers of referrers earn nothing.
- Credit = `referralShareBps` of the taker fee, **only** on fills where the maker is not the referrer (a referrer
  trading against their own referral earns nothing), capped per referrer per market. Claim with `claimReferral`.
- Based on settled fills and collected fees only: never deposits, unfilled orders or raw volume.

## Why wash trading can't profit

`rebateShareBps + referralShareBps ≤ 80%` of the fee (enforced in `addPolicy`). Someone who trades with themselves
through two wallets pays 100% of the fee and can recover at most 80% of it, and only part of that (their share of
the seed weight, within caps). Self-trades on one wallet revert. So fake volume always costs more than it returns.

## Tested

`IncentivesTest`: nothing claimable before any fee; exact pro-rata split (0.33 accrued → 0.165 each); per-wallet cap
and sweep (0.13 returned to protocol); per-market cap; collateral untouched by claims; self, two-way and repeat
referral rejected; no referral credit on fills against the referrer; only the exchange can accrue. The invariant
suite asserts claimed ≤ accrued and reserves equal the incentive contract's balance.

## Honest limits

- Seeder rebates reward liquidity provided at launch, not continuously. A seeder can cancel after the post-launch
  lock and keep its weight. A time-weighted design would need per-block accounting, which we deliberately avoided.
- Referral attribution is per wallet; a person can always create a new wallet before trading. Caps bound the cost.
- Rebates are small by construction and depend on volume. The UI never shows a projected yield.
