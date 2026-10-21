# Testing and deployment

## Suites (results from 2026-10-21)

| Suite | Command | Result |
|---|---|---|
| Contracts (all, incl. v1) | `cd contracts && forge test` | 139 passed |
| Exchange unit + scenario | `forge test --match-path 'test/exchange/*'` | 59 passed |
| Invariants + random walk (CI depth) | `FOUNDRY_PROFILE=ci forge test --match-contract "ExchangeRandomWalkTest\|ExchangeInvariantTest"` | 4 invariants × 12,800 calls, 200 random walks: passed |
| Fork against real Mezo testnet MUSD | `MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*'` | 2 passed |
| Web unit | `cd apps/web && pnpm test` | 99 passed |
| Web integration (real anvil EVM) | `pnpm test:integration` | 14 passed |
| End-to-end (Playwright, local fork) | see below | 35 passed |

## Required scenarios → tests

| # | Scenario | Test |
|---|---|---|
| 1, 2 | Split / merge complete sets | `test_splitCreatesCompleteSet`, `test_mergeReturnsCollateral`, `test_mergeNeedsBothSides` |
| 3, 4 | Winner 1, loser 0 (and Invalid 0.5) | `test_winnerRedeemsOneLoserZero`, `test_invalidPaysHalfPerShare` |
| 5 | Matching signed orders (direct, mint, merge) | `test_signedSellFilledByBuyer`, `test_complementBuyMintsSet`, `test_complementSellMergesSet` |
| 6 | Invalid signatures, replays | `test_forgedSignatureRejected`, `test_replayFillsNothing`; API: integration "rejects forged…" |
| 7 | Partial fills capped | `test_partialFillsCapped` |
| 8 | Cancellation and expiry | `test_cancelledNonceAndExpiredOrdersSkipped`; integration "'removed' only hides…" |
| 9, 10, 11 | All-YES, no liquidity at price, oversized order | `AllYesScenarioTest`, `test_takerLimitPriceRespected`; E2E "a big market buy fills only real liquidity", "all-or-nothing…" |
| 12 | One-sided seeding never graduates | `test_oneSidedSeedingDoesNotGraduate`, `test_wideSpreadOrThinDepthOrOneSeederDoesNotGraduate` |
| 13 | Graduation when met | `test_graduatesWhenAllCriteriaMet`; E2E "launch needs funded depth…" |
| 14 | Removed depth blocks graduation | `test_removingDepthBlocksGraduation`, `test_depthOutsideBandDoesNotCount` |
| 15 | Expired seeding, full refunds | `test_expiredSeedingRefundsEverything`; E2E "refunds every seeder exactly" |
| 16 | Cancel/fund/graduate races | `test_seedLocksAroundGraduation` (locks), atomic `graduate` re-check; random walk interleavings |
| 17 | No double use of escrow | `test_filledEscrowCannotBeRefunded`, `invariant_escrowMatchesOpenOrders` |
| 18 | No liabilities beyond collateral | `invariant_sharesFullyBacked`, `invariant_bucketsEqualBalance` |
| 19, 20 | Fees/rebates isolated; no unfunded rebate | `test_rebatesFundedOnlyByFees`, `test_rebatePerWalletCapAndSweep`, `test_rebatesStopAfterPeriodAndCapPerMarket` |
| 21 | Self-referral and duplicates | `test_referralRules`, `test_referrerEarnsNothingTradingAgainstOwnReferral`, `test_cannotSetReferrerAfterTrading` |
| 22 | Application role grants/revocations | `tests/unit/platform.test.ts` (roles and administration, bootstrap) |
| 23 | On-chain curator authorization/revocation | `test_revokedCuratorCannotApprove`, `test_approvalBindsPolicyAndIsSingleUse`; platform role-op confirmation |
| 24 | Reorgs, indexing failures, timeouts | integration: reorg recovery, RPC failure and retry, lag, divergence repair |
| 25 | Resolution, finality, claims | `test_disputedResolutionAndOneTimeFinality`; E2E resolution suite |

## End-to-end locally

```bash
./scripts/dev-chain.sh                      # anvil fork of Mezo testnet + exchange + local policy
pnpm --filter web build && pnpm --filter web start
pnpm --filter web seed:local                # 8 markets: failed, live, closed, proposed, disputed, resolved, invalid, seeding
pnpm --filter web test:e2e
```

The seed script uses only real transactions and the real order API (curator approvals, seed orders, graduation,
escrowed and signed fills, resolution).

## Deploying to Mezo testnet

Verified on 2026-10-21 against the live testnet: chain id 31611, MUSD
`0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` (18 decimals, symbol MUSD; the script refuses otherwise), block gas
limit 10,000,000. Gas is paid in BTC (the native asset), not MUSD.

```bash
cd contracts
cast wallet import deployer --interactive          # once; never put a raw key in env files
OWNER=0x… ARBITRATOR=0x… RESOLVER=0x… CURATOR=0x… CREATOR=0x… \
  forge script script/DeployExchange.s.sol --rpc-url mezo_testnet --broadcast \
  --gas-estimate-multiplier 105 --account deployer
forge build && node ../scripts/export-abi.mjs      # only if the contracts changed
```

Then the owner calls `acceptOwnership()` on the exchange and the factory. Set in the web host:
`NEXT_PUBLIC_CHAIN_ID=31611`, `NEXT_PUBLIC_MARKETS_ADDRESS=<MezonkExchange>`, `NEXT_PUBLIC_MARKETS_DEPLOY_BLOCK`,
`DATABASE_URL`, `CRON_SECRET`, `INITIAL_ADMIN_WALLETS`, `BLOB_READ_WRITE_TOKEN`. Run migrations through `0005_orderbook`
(additive; no data is deleted). Policy values can be overridden with `POLICY_*` variables (see the script).

Mainnet requires `ALLOW_MAINNET=true` and `NEXT_PUBLIC_ENABLE_MAINNET=true` and must not happen before an independent
review.

## Status

| | |
|---|---|
| Implemented | contracts, indexer, order API, trading/seeding/portfolio/admin UI, docs |
| Tested | everything in the table above |
| Configured | local fork only |
| Deployed | **nothing public**: no testnet or mainnet transaction was sent (no funded deployer key here) |
