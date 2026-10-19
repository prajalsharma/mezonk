# MEZONK: rules for agents working in this repo

## What this is
Binary prediction market on Mezo settled in MUSD. `contracts/` (Foundry) + `apps/web/` (Next.js 15, wagmi/RainbowKit, Drizzle, indexer).

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
- Design: tokens in `src/app/globals.css`; red (#FF004D) is rare (marker, NO, destructive); no eyebrow labels, pills, glass or gradient text.

## Commands
- Contracts: `cd contracts && forge test` (fork: set `MEZO_TESTNET_RPC_URL`)
- Web: `cd apps/web && pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`
- E2E: `./scripts/dev-chain.sh`, `pnpm --filter web build && pnpm --filter web start`, `pnpm --filter web seed:local`, then `pnpm --filter web test:e2e`
- After changing the contract ABI: `forge build && node scripts/export-abi.mjs`
- After changing the DB schema: `pnpm --filter web db:generate`

## Chain config (verified 2026-10-19)
Mezo Testnet 31611, rpc.test.mezo.org, explorer.test.mezo.org, MUSD 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503.
Mainnet 31612, MUSD 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186. getLogs ≤ 9,999 blocks. EVM target london.
