# BTC-price markets settled by Mezo's PriceFeed

`contracts/src/MezonkPriceResolver.sol` is a market resolver that settles "BTC above/below $X" markets from Mezo's
MUSD PriceFeed: the same BTC price Mezo uses for loans and liquidations. It's an ordinary resolver, so the curator
assigns it to a market, it posts the proposer bond, and the proposal can still be disputed and arbitrated.

## What was verified (2026-11-04)
- Mezo testnet PriceFeed `0x86bCF0841622a5dAC14A313a15f96A95421b9366` reads its oracle at
  `0x7b7c000000000000000000000000000000000015` (a chain precompile). `latestRoundData()` works; `getRoundData()` is
  **not supported** ("method not found"). There is no price history, so the price has to be read at the time it
  describes. `fetchPrice()` reverts "PriceFeed: Oracle is stale." if the last update is over 60 s old
  (mezo-org/musd `PriceFeed.sol`, `MAX_PRICE_DELAY = 60`).
- Foundry can't simulate the precompile locally, so nothing at deploy time calls the feed. On the real chain it works.
- The resolver only needs `getMarket`, `resolution` and `collateralToken` from the exchange, so it works with the
  exchange already deployed at `0x4555cfF1…49B9` (deploy simulated against it, 1.68M gas).

## Rules the contract enforces
- `setRule(marketId, strike, direction)`: owner only, once, before close, only for markets naming this resolver.
  Strike is USD per BTC with 18 decimals. `Above` = Yes if price ≥ strike; `Below` = Yes if price < strike.
- `settle(marketId)`: anyone, from close until `close + captureWindow` (default 15 min). It reads `fetchPrice()`,
  requires the oracle's `updatedAt ≥ closeTime` (no pre-close price), stores price, round, update time and block,
  emits `PriceCaptured`, and proposes through MezonkResolution with an evidence hash of all of it.
- `proposeManual(...)`: owner only, only after the window passes without a reading. Still disputable.
- `withdrawBonds()`: anyone; pulls returned bonds back to the resolver. `sweep(to, amount)`: owner.

Tests: `contracts/test/exchange/PriceResolver.t.sol` (12, against the real exchange and resolution contracts).

## Run it on testnet
1. Deploy (owner keystore):
   ```
   cd contracts
   EXCHANGE=0x4555cfF10200e1007435Cffc683C60683c5C49B9 \
     forge script script/DeployPriceResolver.s.sol --rpc-url https://rpc.test.mezo.org --broadcast --account deployer
   ```
2. Allowlist it as a resolver and fund its bonds (25 MUSD per market on the current config):
   ```
   FAC=0x3d596A0317AD7159d0E9f4A15D80A62FFC30D689
   cast send $FAC "setResolver(address,bool)" <RESOLVER> true --account deployer --rpc-url https://rpc.test.mezo.org
   cast send 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 "transfer(address,uint256)" <RESOLVER> 250000000000000000000 --account deployer --rpc-url https://rpc.test.mezo.org
   ```
3. Web: set `NEXT_PUBLIC_PRICE_RESOLVER=<RESOLVER>` in Vercel. Market pages for those markets show the rule and,
   after settling, the exact reading.
4. Bot (Render): set `MM_PRICE_RESOLVER=<RESOLVER>`. Every pass it settles markets inside their capture window.
5. Each BTC market: the curator assigns `<RESOLVER>` as resolver when approving. After it's published and before it
   closes, record its rule, e.g. "BTC at or above $100,000":
   ```
   cast send <RESOLVER> "setRule(uint256,uint128,uint8)" <MARKET_ID> 100000000000000000000000 0 --account deployer --rpc-url https://rpc.test.mezo.org
   ```
   The question text must say the same thing ("…on Mezo's BTC price feed when trading closes").
