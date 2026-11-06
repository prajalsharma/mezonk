# BTC up or down, with BTC (MezonkBtcRounds)

`contracts/src/MezonkBtcRounds.sol` lets people stake native BTC on BTC's price going up or down over the next
interval, decided by Mezo's MUSD PriceFeed: the same BTC price Mezo uses for loans and liquidations. The Mezo team
asked for exactly this ("It would be interesting to bet on BTC up or down using BTC"). It is standalone: it needs
nothing from the exchange and holds nothing but stakes. User docs: `apps/web/content/docs/mezo/btc-up-down.mdx`.

Status (2026-11-06): built and tested, **not deployed**. The `/btc` page is being built alongside it.

## What was verified
- `forge test --match-path 'test/exchange/BtcRounds.t.sol'`: 16 passed (2026-11-06), including
  `testFuzz_poolIsConserved` (payouts + fee never exceed the pool and fall short of it by at most 1 wei per winner).
  The tests use a mock feed with the real feed's 60-second staleness rule.
- Mezo's PriceFeed facts are the ones verified for the price resolver on 2026-11-04 (docs/PRICE_RESOLVER.md): testnet
  `0x86bCF0841622a5dAC14A313a15f96A95421b9366`, mainnet `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88`;
  `fetchPrice()` reverts "PriceFeed: Oracle is stale." after 60 s; the oracle is a precompile with
  `latestRoundData()` only, no history. Nothing at deploy time calls the feed, because Foundry can't simulate the
  precompile.
- The ABI is exported as `btcRoundsAbi` in `apps/web/src/lib/contracts/abi.ts` (`scripts/export-abi.mjs`).
- Not verified yet: a deployment on testnet, a real `roll()` against the live oracle, the `/btc` page.

## Rules the contract enforces
- Timing is immutable: `genesis`, `interval` (≥ 5 min), `captureWindow` (60 s to under one interval). Round r
  (0-based): bets from `genesis + r·interval` until `lockTime(r) = genesis + (r+1)·interval`; price window until
  `closeTime(r) = lockTime(r) + interval`. Round r+1's betting window is round r's price window, so one round is
  always open. `currentRound() = (now − genesis) / interval`.
- `bet(round, side)` payable: only the current round before its lock time; reverts if paused; `fetchPrice()` must not
  be stale; `msg.value × price / 1e18` must be within `minStakeUsd..maxStakeUsd`; one side per wallet per round
  (same side adds). Emits `BetPlaced(round, account, side, amount, usd, price)`.
- `roll(round)`: anyone, from `lockTime(round)` for `captureWindow` seconds. Requires the oracle's `updatedAt ≥
  lockTime(round)` (otherwise `NotYet`, retry). One call locks `round` at that price and settles `round − 1` with the
  same price, so there is exactly one price per boundary. The fee (`pool × feeBps / 10000`) is taken only when the
  settled round has a winner. Emits `Rolled(round, price, updatedAt, settledRound, settledResult)`.
- Result: Up if close > lock, Down if close < lock. Void (full refund, no fee) on a tie, when either side has no
  stakes, or when a capture window passed without a roll (`result()` reports Void once `lockTime + captureWindow`
  or `closeTime + captureWindow` has passed without the capture).
- Payout: void → stake back; loser → 0; winner → `stake × (pool − fee) / winningPool`. `claim(roundIds)` pays
  native BTC for any mix of rounds, skips pending ones, never expires, reentrancy-guarded.
- Owner (`Ownable2Step`): `setStakeLimits` (min > 0, max ≥ min), `setFee` (≤ 500 bps), `setPaused` (bets only;
  rolling and claiming always work), `sweep(to)` (accrued fees only; stakes can't be swept). No upgrade path.

## Deploy on testnet
Defaults in `contracts/script/DeployBtcRounds.s.sol`: interval 3600 s, capture window 600 s, stakes $8–$125 (so the
$10/$25/$50/$100 chips fit with room for the price moving between quote and confirmation), fee 100 bps (1%), genesis
= the next whole hour after now, owner = the broadcaster. Override with `INTERVAL`, `CAPTURE_WINDOW`,
`MIN_STAKE_USD`, `MAX_STAKE_USD` (whole dollars), `FEE_BPS`, `GENESIS` (unix time), `ROUNDS_OWNER`, `PRICE_FEED`.

```
cd contracts
forge script script/DeployBtcRounds.s.sol --rpc-url https://rpc.test.mezo.org --broadcast --account deployer
```

The script prints the address, feed, genesis and settings. Mainnet needs `ALLOW_MAINNET=true` and must not happen
before an independent review.

Then:
1. Web (Vercel): set `NEXT_PUBLIC_BTC_ROUNDS=<ROUNDS>`. The `/btc` page (`features/btc`) and the docs' `<Contracts />`
   table read it through `deployment.btcRoundsAddress` in `lib/chain/config.ts`.
2. Bot (Render): set `MM_BTC_ROUNDS=<ROUNDS>`. A second loop in `apps/web/scripts/market-maker.ts` (`btcRoundsLoop`,
   checked every `MM_BTC_INTERVAL` seconds) calls `roll(currentRound())` once the lock time has passed and the oracle
   has updated, inside the capture window. Rolls cost gas in BTC, so keep the bot wallet
   funded. If the bot is down for a window, the rounds that needed that price void and refund; nothing is lost.
3. Sanity check once the first boundary has passed:
   ```
   R=<ROUNDS>; RPC=https://rpc.test.mezo.org
   cast call $R "currentRound()(uint256)" --rpc-url $RPC
   cast call $R "getRound(uint256)((uint128,uint128,uint128,uint128,bool,bool,uint128))" 0 --rpc-url $RPC
   cast call $R "btcForUsd(uint256)(uint256,uint256)" 25000000000000000000 --rpc-url $RPC   # BTC for $25, and the price
   ```

## Operate
All owner calls: `--account deployer --rpc-url https://rpc.test.mezo.org`.

```
R=<ROUNDS>
# Pause new bets (rolling and claiming keep working). false to resume.
cast send $R "setPaused(bool)" true --account deployer --rpc-url https://rpc.test.mezo.org

# Stake limits in USD with 18 decimals: $10 to $200
cast send $R "setStakeLimits(uint128,uint128)" 10000000000000000000 200000000000000000000 --account deployer --rpc-url https://rpc.test.mezo.org

# Fee in bps (max 500)
cast send $R "setFee(uint16)" 100 --account deployer --rpc-url https://rpc.test.mezo.org

# Accrued fees, then sweep them (only `fees` is ever paid out here)
cast call $R "fees()(uint256)" --rpc-url https://rpc.test.mezo.org
cast send $R "sweep(address)" <TO> --account deployer --rpc-url https://rpc.test.mezo.org

# Roll by hand if the bot is down (round = currentRound(), inside its capture window)
cast send $R "roll(uint256)" <ROUND> --account deployer --rpc-url https://rpc.test.mezo.org
```

Changing `interval`, `captureWindow`, `genesis` or the feed means a new deployment; they are immutable. Pause the
old one first so nobody bets on it, let its last rounds settle or void, and leave it up: claims never expire.
