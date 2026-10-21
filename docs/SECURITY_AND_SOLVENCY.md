# Security and solvency

Scope: `MezonkExchange`, `MezonkMarketFactory`, `MezonkResolution`, `MezonkIncentives` (Solidity 0.8.24, via-IR,
London EVM, OpenZeppelin). **Not independently audited. Not deployed to any public network.** Do not deploy to
mainnet before an external review of these contracts and their economics.

## Accounting buckets

Every MUSD held by each contract belongs to exactly one bucket; with no stray donations, balance == sum.

| Contract | Buckets |
|---|---|
| Exchange | `totalCollateral` (Σ market collateral backing shares) + `escrowedCollateral` (open resting buy orders) + `protocolFees` |
| Incentives | `rebateReserve` + `referralReserve` |
| Resolution | `lockedBonds` + `bondCreditsTotal` |

Fees are never part of collateral; refundable seed escrow is never revenue; rewards never exceed what fees funded.

## Invariants and where they are tested

| # | Invariant | Evidence |
|---|---|---|
| 1, 2, 7, 13 | Every share is backed: per market, Σ YES (free + escrowed sells) = Σ NO = collateral before finality; after it, collateral = what the remaining shares redeem for | `invariant_sharesFullyBacked`, random walk (200 seeds in CI) |
| 3, 4, 5 | Only the final outcome pays; losers get 0; redemption burns shares | `test_winnerRedeemsOneLoserZero`, `test_invalidPaysHalfPerShare` |
| 6 | Fills never exceed signed or remaining quantity, never past the taker's limit | `test_partialFillsCapped`, `test_takerLimitPriceRespected`, `invariant_escrowMatchesOpenOrders` |
| 8, 9 | Fees, escrow, reserves and collateral are separate buckets | `invariant_bucketsEqualBalance`, `test_ownerWithdrawsOnlyFees` |
| 10 | Rewards ≤ funded fees | `invariant_rebatesWithinAccrued`, `test_rebatesFundedOnlyByFees` |
| 11 | A failed settlement leaves no partial state | Every external function is atomic; reverts roll back (e.g. `minFill` miss) |
| 12 | Rounding can't create value | Lot granularity makes all costs/fees exact; `testFuzz_fillConservesValue` |
| 14 | No unauthorized parameter change or withdrawal | `test_onlyOwnerAdministers`, `test_onlyFactoryOpensAndOnlyResolutionSettles`, owner has no path to collateral/escrow/reserves |
| 15 | Resolution once, irreversible | `test_disputedResolutionAndOneTimeFinality` |

## Trust model

- **Owner (exchange)**: add/retire policies for future markets, pause new markets/orders/takes/splits, withdraw
  `protocolFees`. Cannot move collateral, escrow, reserves or bonds; cannot change outcomes. No upgradeability.
- **Owner (factory)**: creator/curator/resolver lists and resolution config for future markets.
- **Pause never blocks exits**: cancellation/refunds, merge, resolution, redemption and claims all work while paused.
- **Resolver and arbitrator** (snapshotted per market): as in v1 (`RESOLUTION_DESIGN.md`). The arbitrator remains
  the main point of trust; timeouts settle Invalid so funds are never stuck.
- **Matching service**: none. It can only suggest maker orders; the taker signs and the contract verifies.
- **Indexer/DB**: a read model. It cannot authorize anything financial.

## Threats considered

| Threat | Mitigation |
|---|---|
| Signature replay / reuse after cancel | `filledOf`, `cancelledOrder`, `minNonce`; chain id + exchange in the EIP-712 domain |
| Stale signed orders | contract skips unfunded makers; API checks funding on submit and on quote; sweeper marks stale |
| Price manipulation via invented fills | only taker-signed transactions fill; makers' prices are signed; no oracle |
| Unbacked minting | shares only via split or complementary fills that sum to exactly 1 MUSD per set |
| House exposure / all-YES demand | no house position exists; `AllYesScenarioTest` |
| Graduation gaming | on-chain escrow only, spread + band depth + funded seeders; locks around launch |
| Sybil seeders | per-seeder minimum escrow; documented that wallets ≠ people |
| Wash trading for rewards | incentives ≤ 80% of fee; self-trade revert; referrer-as-maker excluded |
| Fee-on-transfer tokens | balance-delta check on every pull (`UnsupportedToken`) |
| Reentrancy | `nonReentrant` on all state-changing entry points; MUSD is a standard ERC-20 |
| Front-running a quote | taker sets a limit and min fill; worst case is fewer shares, never a worse price |

## Known limitations and blockers before mainnet

1. **No external audit** of the new contracts or economics.
2. **Deploy gas margin**: 9.05M of a 10M block gas limit. Any growth must be re-measured.
3. Signed-order matching is taker-driven; there is no off-chain matcher that crosses two resting makers, so a crossed
   book can't occur on the escrow side but signed liquidity is only executed when a taker arrives.
4. The off-chain book's rate limits are in-memory per instance; production needs an edge limiter.
5. Seeder rebates reward launch liquidity, not time-weighted liquidity.
6. Arbitrator is a single address.
7. Testnet deployment has not been performed (no funded deployer key was available in this environment).
