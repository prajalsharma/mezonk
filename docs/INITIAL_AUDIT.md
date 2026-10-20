# Initial audit

Two audits are recorded here: the original one (greenfield) and the current-state audit taken before the governance and redesign work.

## Current state (2026-10-20, before governance/redesign)

**Repository:** `~/mezonk`, pnpm monorepo, private GitHub repo `prajalsharma/mezonk`, branch `main`, clean working tree.
This is the dedicated MEZONK prediction-market project (not the Vezo/veNFT marketplace). Target: Mezo EVM.

| Area | State | Real / simulated |
|---|---|---|
| Contract `MezonkMarkets` | FPMM over fully-backed Yes/No sets, optimistic resolution (resolver → challenge → arbitrator, Invalid fallback), claims, fees, pause | **Real**; 61 Foundry tests + fork test with real MUSD |
| Market creation | **Permissionless**: any wallet with the minimum seed liquidity can publish a live market | Real, but **does not meet the new governance requirement** |
| Indexer | getLogs → raw events → pure replay → derived tables; reorg rewind; reconciliation | Real; integration-tested on anvil |
| API | markets, history, activity, portfolio, resolution, evidence documents, drafts, health, status, cron | Real; read-only except drafts/evidence |
| Frontend | discover, markets, detail + trade + resolution panel, create wizard, portfolio + claims, activity, docs, status | Real data only; local fork works end to end |
| Auth for backend writes | none needed so far (no privileged backend actions) | Will need wallet-signed requests for curation |
| Roles | owner, resolver allowlist, arbitrator (on-chain) | No creator / curator / project roles |
| Brand | M-mark logo, cream/ink/red tokens, Hanken Grotesk | **Superseded** by the split-coin logo; YES=green/NO=red conflicts with new brand rule (red = YES, ink = NO) |
| Motion | almost none (skeleton pulse, spinners) | — |
| Theme | light/dark via `data-theme`, toggle, system default | Works; no explicit "system" option, no settings page |

**Deployment:** nothing on a public network. Local fork only (`scripts/dev-chain.sh`). Deploy script dry-run passed against public testnet.

**Chain config (verified 2026-10-19):** Mezo Testnet 31611 (`rpc.test.mezo.org`), MUSD `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`; mainnet 31612, MUSD `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`.

**Source of truth per state:**
| State | Authority |
|---|---|
| Balances, positions, claimable amounts, market stage, outcome, bonds | Contract (read live) |
| Rules text | `MarketCreated` event; DB copy verified by hash |
| History, P&L, activity, timelines | Indexed DB (rebuildable from logs) |
| Evidence document text | DB, verified against on-chain hashes |
| Market suggestions, reviews, projects, settings (new) | DB workflow store; publication itself gated on-chain |

**Gaps against the new brief:** no market governance (anyone can publish), no curator review, no project verification, no audit log, old logo, outcome colours off-brand, thin motion, no settings/profile/curator screens.

## Original audit (2026-10-19)

- No repository existed; created the monorepo. Toolchain: Node 22.23.1, pnpm 10.20, Foundry 1.6.0; no Postgres/Docker (PGlite used locally); Slither installed via pip.
- Mezo facts verified on live RPC and official docs (see `competitive-analysis.md`, `CLAUDE.md`).
- Mezo Passport deferred: requires React 18 and pins RainbowKit 2.0.2.
