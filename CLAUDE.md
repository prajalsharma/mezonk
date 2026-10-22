# MEZONK: rules for agents working in this repo

## What this is
Binary prediction market on Mezo settled in MUSD, traded on an order book with fully collateralized YES/NO shares.
`contracts/` (Foundry: `MezonkExchange` + `MezonkMarketFactory` + `MezonkResolution` + `MezonkIncentives`; the v1 AMM
`MezonkMarkets` is kept for reference only) + `apps/web/` (Next.js 15, wagmi/RainbowKit, Drizzle, indexer).
Read docs/ORDERBOOK_ARCHITECTURE.md and docs/SECURITY_AND_SOLVENCY.md before touching money paths.

## Hard rules
- **No fabricated data.** Never show hardcoded balances, volumes, prices, users or activity as live. Unavailable means an explicit unavailable state.
- **Chain is authoritative.** Stage, balances and claimable amounts are read from the contract. The DB is an indexed copy and never authorizes anything.
- **Chain time, not wall clock,** for anything lifecycle-related (`useBlock` on the client, `chainNowMs()` on the server).
- **Verified addresses only.** Network and token config lives in `apps/web/src/lib/chain/config.ts` and `contracts/src/MezoAddresses.sol`. Never resolve a token by symbol.
- **No secrets in git or NEXT_PUBLIC_*.** Deploy keys go in a Foundry keystore. The app needs no keys.
- **No mainnet deploys** without explicit owner authorization (`ALLOW_MAINNET`, `NEXT_PUBLIC_ENABLE_MAINNET`).
- **Explorer links only for verified public networks** (`hasExplorer`); never on local forks.
- **The contract is not upgradeable.** Interface changes mean a new deployment (see docs/RESOLUTION_DESIGN.md §8).
- Permissions for UI actions come from `lib/market/permissions.ts` only. Don't scatter address checks.
- Backend capabilities (profiles, comments, media, admin) come from `apps/web/src/lib/auth/capabilities.ts` via `hasCap`/`requireCap`. Never trust a role, wallet or author from the request body. Creator/curator live on-chain; ADMINISTRATOR and suspension live in the DB (see docs/USER_PROFILES_AND_RBAC_ARCHITECTURE.md).
- Design: tokens in `src/app/globals.css` (Seam brand, 2026-10-22; contrast in docs/design/contrast.md). **Blue = YES and the brand, near-black/near-white = NO**; bids/asks follow YES/NO, red/green only for loss/gain, errors use `--danger`. One sans (Geist) + Geist Mono for numbers only; no serif, no italic accent words; radii 4/8/14. Light by default, follows the OS. Logo: `components/brand/Logo.tsx` (Seam mark + SVG wordmark). Glass only on floating surfaces. No eyebrow labels, pills or gradient text. Scroll reveals must never hide content by default (`forwards` fill only).
- Market creation is governed: approved creators publish curator-signed proposals through the factory (docs/MARKET_GOVERNANCE.md, docs/ROLE_MANAGEMENT.md). Never add a path that lets a wallet publish without a curator approval, or that makes a market tradable without on-chain graduation.
- Money math is bigint with whole-cent prices and 0.01-share lots (`lib/orderbook/math.ts`). Never use floats for amounts. Only a real fill is a price; a book midpoint is "indicative"; no trade means no number.
- Deadlines and expiries sent to the contract use chain time (latest block), never `Date.now()`.
- Exchange deployment uses ~9.05M of Mezo's 10M block gas: deploy with `--gas-estimate-multiplier 105` and re-measure after any contract change.

## Commands
- Contracts: `cd contracts && forge test` (fork: set `MEZO_TESTNET_RPC_URL`)
- Web: `cd apps/web && pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`
- E2E: `./scripts/dev-chain.sh`, `pnpm --filter web build && pnpm --filter web start`, `pnpm --filter web seed:local`, then `pnpm --filter web test:e2e`
- After changing the contract ABI: `forge build && node scripts/export-abi.mjs`
- Contract sizes: `forge build --sizes` (MezonkExchange must stay under 24,576 bytes runtime and 49,152 init code)
- After changing the DB schema: `pnpm --filter web db:generate`

## Chain config (verified 2026-10-19)
Mezo Testnet 31611, rpc.test.mezo.org, explorer.test.mezo.org, MUSD 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503.
Mainnet 31612, MUSD 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186. getLogs ≤ 9,999 blocks. EVM target london.
Deployed on testnet (2026-10-22): MezonkExchange 0x4555cfF10200e1007435Cffc683C60683c5C49B9, deploy block 16298919
(details in docs/TESTING_AND_DEPLOYMENT.md). Testnet RPC has a lagging node: app clients use laggingNodeFetch, scripts use
scripts/rpc-retry-proxy.mjs.
