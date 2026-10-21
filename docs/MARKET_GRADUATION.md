# Market lifecycle and graduation

## States

Off-chain workflow (unchanged): `draft → submitted → under_review → (changes_requested ↺) → approved → published`,
or `rejected` / `withdrawn`.

On-chain (`MezonkExchange.stageOf`, plus `MezonkResolution.stageOf` once closed):

```
published ──► SEEDING ──graduate()──► LIVE ──close──► CLOSED ──► PROPOSED ──► [DISPUTED] ──► FINALIZED (Yes / No / Invalid)
                 │
                 └── seeding deadline passes ──► FAILED (refunds only, never resolved, never pays a winner)
```

| Prompt name | Here |
|---|---|
| DRAFT / SUBMITTED / CHANGES_REQUESTED / REJECTED | proposal workflow statuses |
| APPROVED | proposal `approved` (curator signature stored) |
| SEEDING | exchange stage `Seeding` |
| LIVE | `Live` (UI: "Live", or "Low liquidity" when one side is empty or the spread > 10¢) |
| CLOSED / RESOLUTION | `Closed`; resolution stages AwaitingProposal, Proposed, Disputed |
| FINALIZED / CLAIMABLE | `Finalized`; redeem open, no deadline |
| CANCELLED / EXPIRED | `Failed` (seeding deadline passed); signed orders `expired` |
| INVALID | final outcome Invalid (0.5 per share) |

Approval is not enough to trade. A curator's approval lets an approved creator publish, which starts seeding.

## Policies

A policy is an immutable, numbered set of graduation, fee and incentive parameters added by the exchange owner
(`addPolicy`). The curator's EIP-712 approval binds the policy id, and the market stores it at publication.
Adding a new policy, or retiring one with `setPolicyActive(id, false)`, never changes markets already published.

| Parameter | Meaning | Testnet default (deploy script) | Local fork |
|---|---|---|---|
| `minBidDepth` | YES shares bid within `band` of the best bid | 100 | 50 |
| `minAskDepth` | YES shares offered within `band` of the best ask | 100 | 50 |
| `band` | depth window, cents | 5 | 5 |
| `maxSpread` | best ask − best bid, cents | 10 | 10 |
| `minSeeders` | distinct wallets with ≥ `minSeederNotional` escrowed | 2 | 2 |
| `minSeederNotional` | MUSD escrowed to count as a seeder | 10 | 10 |
| `seedingPeriod` | publication → deadline | 7 days | 2 hours |
| `minRest` | seed-order cancel lock after placement and after launch | 1 hour | 60 s |

Bounds enforced by the contract (and mirrored in `lib/orderbook/policy.ts`): depth > 0 and lot-aligned, 1 ≤ spread
≤ 98, band ≤ 98, seeding 1 hour to 60 days, minRest ≤ 7 days, fee ≤ 5%, rebate + referral share ≤ 80% of the fee,
claim window 7 to 365 days.

## Seeding

- Only **escrowed buy orders** can be placed (YES bids, and NO bids which are YES asks). Splitting, signed orders
  and taking are refused (`NotTradable`). The book may not cross.
- A seed order locks `quantity × price` MUSD. Its terms (outcome, price, quantity) are explicit; it is not a generic
  deposit. It becomes a normal resting order at launch, so it can then fill and the seeder holds that side.
- Seed weight per wallet = MUSD escrowed in seed orders; it falls if an order is cancelled before launch and is
  frozen at launch (used for rebates).
- Cancel lock: a seed order can't be cancelled for `minRest` after placement, and again for `minRest` after launch.
  Counted liquidity therefore stays executable at launch. No lock applies once a market fails or closes.

## Graduation is verified on-chain

`graduate(marketId)` is permissionless. The contract recomputes, from its own escrow book, in the same transaction:

1. Both sides non-empty, best ask > best bid, spread ≤ `maxSpread`.
2. Bid depth within `band` of the best bid ≥ `minBidDepth`; ask depth within `band` of the best ask ≥ `minAskDepth`.
3. `seederCount ≥ minSeeders`.
4. The market is still seeding (before the deadline).

Depth is kept per price level with a 99-bit bitmap per side, so best prices and band sums are bounded loops (≤ 99
iterations, not a loop over orders). The backend can display `graduationCheck` but cannot affect it: only escrowed
on-chain orders count, so liquidity can't be manufactured off-chain. No curator attestation is involved.

What it does not prove: distinct wallets are not distinct people. The per-seeder minimum makes Sybil seeding cost
real, locked money, and one-sided or crossed books can't pass, but someone with enough MUSD can be several seeders.

Graduation is one-time. If seeders later cancel (after the lock) or get filled and the book thins, the market stays
LIVE and the UI shows "Low liquidity".

## Failure and refunds

After the deadline without graduation the stage is `Failed`, permanently. Each seeder calls `cancelOrder` and gets
exactly `remaining × price` back. This works directly against the contract with no backend; there is no fee; a
second call reverts (`NothingToClaim`); a failed market can't be resolved (`MezonkResolution` reports `NotClosed`)
and can never pay a winner. Tested in `SeedingTest.test_expiredSeedingRefundsEverything` and the
"refunds every seeder exactly" end-to-end test.

## One-sided demand (everyone wants YES)

There is no price at which the contract will sell YES that nobody offers. A buy fills only against existing YES
asks (sell orders, or NO bids that mint sets with the buyer). When they run out, the rest is not filled; with
`minFill` it reverts. `AllYesScenarioTest` walks the full funding flow: 1,000 YES requested at ≤ 60¢, only 200
offered at 55¢, exactly 200 fill for 110 MUSD + 1.10 fee, the seeders' 90 MUSD escrow completes 200 sets, the book
is empty afterwards, and when YES wins the 200 MUSD payout comes entirely from that collateral. The owner's balance
is asserted unchanged. A market where seeders only bid one side can't graduate at all.
