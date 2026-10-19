# Protocol design

## Mechanisms considered

| | A. Fully collateralized Yes/No shares + AMM (chosen) | B. Pari-mutuel pools |
|---|---|---|
| Payout guarantee | fixed: each winning share = 1 MUSD, known at purchase | unknown until close: winners split the losing pool |
| Liabilities | exactly bounded: outstanding pairs = collateral | always equal to the pool; simple |
| Price discovery | continuous; price = implied probability | pool ratio only; late money moves odds |
| Exit before close | yes (sell to pool) | no |
| Capital efficiency | needs seed liquidity; LP bears inventory risk | no LP needed |
| Manipulation | price can be pushed, but at a cost (slippage paid to the pool) | last-second pile-ins change everyone's payout |
| Gas (measured, Foundry gas report) | create 362k median (max 385k), buy 139k, sell 58–85k; propose, dispute, finalize and redeem 50–90k | lower |
| Complexity | AMM math, rounding | low |

We chose **A**. Its liabilities can be stated and tested exactly, users know what they get, and exits work.
The cost (creator seed liquidity and LP risk) is disclosed in the create flow.

## Contract

One non-upgradeable manager, `MezonkMarkets`, holds all markets (cheaper than a contract per market, and one address to index).
Pure math lives in `FPMMMath`.

### Complete sets and pool
- Collateral `c` for a market equals the number of outstanding Yes/No pairs.
- Pool holds `y` Yes and `n` No; invariant `y · n = k`. Yes price = `n / (y + n)`.
- **Buy Yes with `a` MUSD:** fee `f = a·feeBps/1e4` (rounded down); `net = a − f` mints `net` pairs into the pool. The pool keeps all
  No and releases Yes so that `y' = ceil(y·n / (n + net))`. The buyer gets `y + net − y'`. Rounding favours the pool, so k never decreases.
- **Sell `s` Yes:** the seller adds `s` Yes to the pool; the pool burns `g` pairs, where `g` is the smaller root of
  `g² − g(y+s+n) + s·n = 0`, computed with sqrt rounded **up** and then stepped down until `(y+s−g)(n−g) ≥ k`.
  The seller receives `g − fee`.
- **Seeding at probability p:** the side the creator favours is partly withdrawn from the pool and given to the creator, so the pool
  opens at price p. Creation is bounded to 5%–95%.

### Settlement
- Yes wins: each Yes share pays 1; No pays 0. No wins: the reverse. Invalid: each share of either side pays 0.5 (`(y+n)/2`, rounded down).
- The creator withdraws the pool's remaining shares at the same rate after finalization (`claimLiquidity`).

### Accounting invariants (tested)
1. `MUSD.balanceOf(contract) == Σ collateral + Σ creatorFees + protocolFees + live bonds + bondCredits` (invariant suite, 8,192 random calls per run).
2. Before finalization: pool Yes + Σ user Yes == collateral == pool No + Σ user No, per market.
3. After finalization: collateral ≥ everything still claimable.
4. k is non-decreasing across trades (fuzzed in `FPMMMath.t.sol`); a buy followed by a sell never returns more than was paid.
5. Fees accrue to separate buckets; they are never taken from collateral backing shares.

### Other design points
- The collateral token is immutable and set at deploy; fee-on-transfer tokens are rejected via a balance-delta check.
- Each market snapshots its parameters (fee, fee split, windows, bonds, arbitrator) at creation. Owner changes affect new markets only.
- `nonReentrant` on every state-changing external call; checks-effects-interactions in all payouts.
- Pause covers `createMarket`, `buy` and `sell` only.
- Positions are internal balances (not ERC-1155) in v1: no transfer surface. Exits go through the pool.
- Resolution is described in [RESOLUTION_DESIGN.md](RESOLUTION_DESIGN.md).

## Lifecycle states

Draft (off-chain, browser-local) → Open → Closed → Proposed → Disputed → Finalized (Resolved Yes/No, or Invalid).
"Settled" is not a separate state: a finalized market keeps its collateral until every holder redeems, and claims have no deadline.

## Known limitations

- The arbitrator is a single address (intended to be a multisig).
- LP risk falls on the creator alone. A multi-LP liquidity module was deliberately left out of v1.
- No early resolution: a market can't settle before its close time even if the event already happened. Creators should close at or before the event.
