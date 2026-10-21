# Order book architecture

Status (2026-10-21): implemented and tested on a local fork of Mezo testnet and against the real MUSD contract
in a Foundry fork test. **Not deployed to any public network.** No independent audit.

## Why a CLOB, and why this shape

The direction is a Polymarket-style central limit order book with YES/NO outcome shares, where the operator is
never the losing counterparty. The previous contract was a fixed-product AMM (see `CURRENT_MARKET_ECONOMICS.md`).
Nothing in the chain or contract constraints prevented an order book, so we built one. A full CTF (Gnosis
Conditional Tokens) plus a separate exchange was considered and not used: it brings ERC-1155 positions, condition
ids and a second large codebase whose licensing, audit history and EVM-version fit would all need separate
review, and Mezo's 24 KB code limit and 10M block gas limit are already tight for one exchange. Instead the
exchange keeps a minimal internal share ledger with the same economics (split, merge, redeem).

## Contracts

| Contract | Holds | Does |
|---|---|---|
| `MezonkExchange` | Market collateral, escrow, protocol fees | Shares (split/merge/transfer/redeem), resting escrowed orders, signed-order settlement (`take`), graduation, policies |
| `MezonkMarketFactory` | Nothing | Creator/curator/resolver lists, resolution config, verifies curator EIP-712 approvals, opens markets |
| `MezonkResolution` | Bonds | Propose → challenge → arbitrate → finalize (unchanged rules from v1), then `exchange.settle` |
| `MezonkIncentives` | Rebate and referral reserves | Fee-funded seeder rebates and referral credit, caps, claims, sweep |

The exchange constructor deploys the other three, so their addresses are fixed forever (`immutable`) and are the
CREATE addresses of the exchange at nonces 1, 2, 3. The app derives them from the one configured exchange address
(`protocolAddresses()` in `apps/web/src/lib/chain/config.ts`; asserted by `DerivedAddressesTest`). The split exists
because one contract exceeded the 24,576-byte EIP-170 limit; it also keeps each kind of money in its own contract.

## Units

- Price: whole cents, 1 to 99, for the outcome being traded.
- Quantity: shares with 18 decimals, in multiples of `LOT = 0.01` share. `q × price / 100` is then always an exact
  integer, and so is the fee (`notional × bps / 10 000`). Nothing rounds anywhere, on- or off-chain.
- All off-chain arithmetic uses `bigint` (`apps/web/src/lib/orderbook/math.ts`). Floats appear only in display ratios.

## Shares

One YES + one NO = one complete set = exactly 1 MUSD of collateral.

- `split(m, q)`: lock q MUSD, receive q YES and q NO (live markets only).
- `merge(m, q)`: burn q YES and q NO, receive q MUSD (any time after launch, until final).
- `redeem(m)`: after the outcome is final, YES or NO pays 1 per winning share, 0 per losing share; INVALID pays 0.5
  per share of either side. Burns the caller's shares, so it can't be claimed twice.

## Two kinds of maker liquidity, one book

| | Signed order | Resting (escrowed) order |
|---|---|---|
| Where it lives | Off-chain (DB), EIP-712 signature | On-chain, `placeOrder` |
| Funds | Stay in the maker's wallet until filled | Locked in the exchange until filled or cancelled |
| Can go stale | Yes: settlement skips it if the maker moved funds or approval | No |
| Counts for graduation | No | Yes (when placed during seeding) |
| Cancel | `cancelSignedOrders` or `raiseMinNonce` on-chain; "Remove" only hides it | `cancelOrder` (locks apply to seed orders) |

Both appear in the same book (`/api/markets/:id/book`), are quoted by the same function, and are filled by the
same `take` call. There are not two competing liquidity sources: a seed order *is* a resting order.

Order struct (EIP-712, domain `MEZONK Exchange` v1, verifying contract = exchange): maker, taker (0 = anyone),
marketId, outcome (0 YES, 1 NO), side (0 buy, 1 sell), price, quantity, expiry, nonce, salt. The TypeScript type
string is checked against the Solidity source in `tests/unit/orderbook.test.ts`.

## Matching: takers settle, the server only suggests

`take(TakeParams, Source[])` is called by the taker. The off-chain service (`apps/web/src/server/orderbook.ts`)
builds the best-first list of sources for a quote; it holds no keys and cannot sign, move funds, change prices or
invent trades. For each source the contract:

1. Verifies the signature (EOA or ERC-1271), market, price range, lot size, self-trade.
2. Skips (never forces) an order that is expired, cancelled, below the maker's min nonce, restricted to another
   taker, already filled, or no longer funded (MUSD balance/allowance for buys, share balance for sells).
3. Checks the taker's price limit for this fill.
4. Fills `min(remaining taker quantity, maker remaining)`.

How a fill moves value, for a maker order on outcome O at price p:

| Maker | Taker | Kind | Effect |
|---|---|---|---|
| buys O @p | sells O | direct | taker's O → maker; maker's p·q → taker |
| buys O @p | buys ¬O @(1−p) | complement | maker pays p·q + taker pays (1−p)·q = q MUSD → **mint q sets**; O → maker, ¬O → taker |
| sells O @p | buys O | direct | maker's O → taker; taker's p·q → maker |
| sells O @p | sells ¬O @(1−p) | complement | maker's O + taker's ¬O **merge** into q MUSD; p·q → maker, (1−p)·q → taker |

So YES and NO books are one book in YES-price terms (a NO bid at 45 is a YES ask at 55). Collateral is conserved in
every case; this is fuzzed in `ExchangeFillFuzzTest` and asserted as an invariant.

The taker pays a fee on its own notional (makers pay none). If less than `minFill` fills, the whole transaction
reverts with `InsufficientLiquidity(filled)`. Otherwise what fills settles and the rest is not executed.

### Order policies offered in the UI

- **Market**: fill now up to a worst price (default best + 3¢, editable); remainder cancelled. Optional
  all-or-nothing (`minFill = quantity`).
- **Limit**: fill whatever crosses now at the limit or better; the remainder rests, either signed (no lock, may go
  stale) or escrowed (one transaction, funds locked, always executable).

## Off-chain service

- `POST /api/orders`: verifies signature, live stage, not cancelled, nonce, remaining, **funding**, and that the order
  does not cross the book (it should take instead). Accepted means "resting on the book", never "traded".
- `GET /api/markets/:id/quote`: exact preview; re-checks funding of every signed order it would use and marks stale
  ones before returning sources.
- `GET /api/markets/:id/book`: YES levels (escrowed portion flagged), best bid/ask, spread, **indicative** mid, and
  the last real fill price (null if none).
- Stale sweep: every 15 indexer ticks (embedded) or each cron run, open/stale signed orders are re-checked and
  flipped stale ↔ open.
- `DELETE /api/orders/:hash` (maker session): hides the order. It stays valid on-chain until cancelled there; the UI
  says this and offers "Cancel on-chain". Proven in `tests/integration/orderbook.test.ts`.

## Indexing

The indexer reads logs from all four contracts in one `getLogs` call and replays each market purely
(`server/indexer/replay.ts`): market row, fills, taker trades, resting orders, positions (average cost), graduation
snapshot, incentive ledger, proposals, disputes. Deployment-wide events (policies, referrer links, signed-order
cancellations, nonce raises) are rebuilt separately. Reorgs rewind 64 blocks and rebuild; reconciliation compares
collateral, graduation, finality and best bid/ask with direct contract reads. The index is a read model: no route
authorizes money movement from it.

## Gas and size (measured)

| Item | Value |
|---|---|
| `MezonkExchange` runtime | 22,677 bytes (limit 24,576) |
| `MezonkExchange` init code | 45,167 bytes (limit 49,152) |
| Exchange deployment (incl. the 3 children) | 9,045,351 gas on a testnet fork; Mezo block gas limit is 10,000,000 |

Deploy with `--gas-estimate-multiplier 105`: Forge's default 30% buffer exceeds the block limit. The margin is thin;
any contract growth must be re-measured before deploying.
