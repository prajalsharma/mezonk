# Implementation plan

## Current phase: governance, redesign, new brand (started 2026-10-20)

### Decisions

1. **Publication is gated on-chain.** `createMarket` requires (a) `msg.sender` is an approved creator and (b) an EIP-712
   `MarketApproval` signed by an approved curator that is not the creator. The approval binds `metadataHash`, `creator`,
   `resolver`, `closeTime`, a `deadline` and a single-use `nonce`. Curators may be contracts (ERC-1271, for Safe multisigs).
2. **Review workflow lives in the backend** (`DRAFT → SUBMITTED → UNDER_REVIEW → CHANGES_REQUESTED / APPROVED / REJECTED → SCHEDULED`),
   with wallet-signed requests and an append-only audit log. After publication the market's lifecycle (`LIVE → CLOSED →
   RESOLUTION → FINALIZED / INVALID`) is read from chain, never stored as authority.
3. **Roles are read from chain where they exist** (owner, curator, creator, resolver, arbitrator). Backend-only roles
   (verified project representative) carry no protocol power: they only add a disclosure and a review queue priority.
4. **New brand:** split-coin logo; red half = YES, ink half = NO. Outcome colours follow the brand; P&L uses separate
   gain/loss semantics so red never means "loss".
5. **Motion:** CSS transitions and keyframes plus small hooks; no animation library until a need is shown.
   Reduced-motion is honoured everywhere.
6. The contract is not deployed publicly, so the `createMarket` signature change needs no migration.

### Phases and status

| # | Work | Status |
|---|---|---|
| 1 | Audit (`INITIAL_AUDIT.md`), frontend audit (`FRONTEND_AUDIT.md`), governance spec (`MARKET_GOVERNANCE.md`), architecture (`ARCHITECTURE.md`) | in progress |
| 2 | Contract: creator/curator roles, EIP-712 approvals, tests (unauthorized publish, bypass, self-approval, replay, expiry, param binding, ERC-1271) | next |
| 3 | Backend: proposals, reviews, projects, audit log, settings; signed-request auth; indexer links proposals to markets | |
| 4 | Design system: new logo, outcome tokens, motion, glass for floating surfaces, theme switcher with system option | |
| 5 | Screens: suggest wizard, curator dashboard, proposal status, profile, settings, resolution center, discover upgrades, related markets | |
| 6 | Integration: E2E for governance and themes, keyboard, a11y; docs; push | |

### Earlier phases (done)

Contracts, AMM, resolution, indexer, API, discover/markets/detail/trade/resolution/claims/portfolio/activity/docs/status,
create wizard (to be replaced by the governed flow), 61 contract tests + fork test, 33 unit, 6 integration, 23 E2E.

### Blocked on the owner

Public testnet deployment: funded deployer, owner/arbitrator/resolver (and now curator/creator) addresses, Postgres, hosting.
