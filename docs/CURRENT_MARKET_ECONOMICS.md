# Current market economics (audited 2026-10-21, before the order-book rebuild)

Repository state: branch `main`, commit `71ef184`. Foundry contracts in `contracts/`, Next.js 15 app in `apps/web`
(Drizzle on PGlite locally / Postgres in production, wagmi + RainbowKit, embedded or cron indexer).

## What exists

| Area | Status | Where |
|---|---|---|
| Market creation | Implemented. Approved creator publishes with a curator EIP-712 approval bound to metadata hash, creator, resolver, close time, deadline, nonce. | `MezonkMarkets.createMarket`, `_consumeApproval` |
| YES/NO shares | Implemented as internal per-market balances (`yesBalance`, `noBalance`). Not transferable. | `MezonkMarkets` |
| Share issuance | Only through the AMM: a buy adds collateral, mints a complete set into the pool, and swaps out one side. No user split/merge. | `FPMMMath.buy/sell` |
| Order placement / matching | **Absent.** No orders, no book, no signatures for trades. | |
| Pricing | Fixed-product market maker. `priceYes = poolNo / (poolYes + poolNo)`. | `FPMMMath` |
| Collateral | `m.collateral` = outstanding complete sets. Invariant tests check token balance = sum of buckets. | `test/invariant` |
| Liquidity | One-shot creator seed (`initialLiquidity` at `initialYesProbBps`). Creator is the only LP; claims leftover pool after finalization. | `_initMarket`, `claimLiquidity` |
| Fees | `feeBps` on buy input and sell output; split protocol / creator by `protocolFeeShareBps`. | `_accrueFee` |
| Resolution | Implemented and well tested: resolver proposes with evidence and bond, open dispute with bond, arbitrator rules within a window, timeouts settle INVALID (0.5 per share). | `proposeOutcome`, `dispute`, `arbitrate`, `finalize` |
| Claims | `redeem` burns both sides; `claimCreatorFees`, `withdrawBond`. | |
| Roles | On-chain: owner, resolver, creator, curator, per-market arbitrator. Backend: ADMINISTRATOR + suspension (DB), capability policy. | `lib/auth/capabilities.ts`, `server/roles.ts` |
| Indexing | Event replay into `markets`, `trades`, `positions`, price history; reorg handling. | `server/indexer` |
| Lifecycle | Derived on-chain stage: Open → Closed → Proposed → Disputed → Finalized. Off-chain proposal lifecycle (draft → submitted → in review → approved → published). | `_stage`, `lib/governance/proposal.ts` |
| Deployment | Local anvil fork only. **No testnet or mainnet deployment** (no broadcast artifacts), so no real user positions exist. | `scripts/dev-chain.sh` |

## Is it solvent?

Yes, for what it does. Every share pair is backed 1:1, payouts come only from `m.collateral`, and the fuzz/invariant
suite checks balance equals buckets. The platform is never a counterparty: the creator's seed is the AMM's
inventory, so the creator bears the losses an AMM LP bears.

## Why it does not meet the new direction

- It is an AMM, not an order book. Prices move along a curve rather than meeting real bids and asks.
- A market is tradable the moment it is published. There is no seeding stage and no liquidity condition.
- Liquidity is one wallet (the creator) chosen at publish time. Nobody else can provide it.
- Fee incentives go to the creator only; nothing rewards early liquidity providers or referrers.

## Decision

Build a new, separate contract, `MezonkExchange`, and point the app at it. The old contract stays in the repo
with its tests, unchanged, for reference. Because there is no public deployment, no positions need migrating.
Reused unchanged in spirit: the curator-approval publication path, the resolver/dispute/arbitration module,
INVALID at 0.5 per share, bond pull-payments, pause semantics (never blocks exits), and the backend role system.
See `ORDERBOOK_ARCHITECTURE.md`.
