# Architecture

```
 Browser (Next.js client)                       Server (Next.js route handlers)            Mezo
 ─────────────────────────                       ──────────────────────────────            ────
 wagmi + RainbowKit wallet ──── signs txs ──────────────────────────────────────────────▶ MezonkMarkets
 live reads (stage, pool, balances, claimable) ─────────────────────────────────────────▶ (+ MUSD ERC-20)
 React Query ──▶ /api/* ──▶ queries.ts ──▶ Postgres (prod) / PGlite (local)                  │ events
                                   ▲                                                         ▼
                                   └──────── indexer: getLogs (≤9,999 blocks) ──▶ chain_events ──▶ replay ──▶ markets,
                                             block-hash reorg check, reconcile                      trades, positions,
                                                                                                    proposals, disputes
 Governance (who may put a market in front of traders)
 ──────────────────────────────────────────────────────
 any wallet ── sign-in (nonce + personal_sign → HMAC bearer) ──▶ /api/proposals ──▶ market_proposals, proposal_reviews, audit_log
 curator wallet ── signs EIP-712 MarketApproval(metadataHash, creator, resolver, closeTime, deadline, nonce) ──▶ stored on the proposal
 publisher wallet ── createMarket(params, approval, curator, signature) ──▶ MezonkMarkets verifies: isCreator(msg.sender), isCurator(curator),
                     curator ≠ sender, unexpired, nonce unused, hash/creator/resolver/closeTime match, signature (EOA or ERC-1271)
                     └─▶ emits MarketApprovalUsed(marketId, curator, nonce) ──▶ indexer links the proposal → status "published"
```

## Boundaries
- **Contract (`contracts/src`)**: custody, pricing, resolution, settlement. The only authority over funds and outcomes.
- **Indexer (`apps/web/src/server/indexer`)**: copies events into `chain_events` (unique on chain, tx, log index), then
  `replay.ts` (pure) rebuilds each touched market's derived rows. Reorgs are handled by comparing the stored block hash
  and rewinding 64 blocks. `reconcile()` compares pools, collateral and finality against `getMarket`.
- **API (`apps/web/src/app/api`)**: read-only views of indexed data plus writes that never touch funds: evidence
  documents, signed community evidence, and the governance workflow (proposals, reviews, projects, settings) behind
  wallet sessions. Errors use `{error:{code,message}}`. Inputs are zod-validated. Writes are rate-limited per instance.
- **Governance workflow (`server/governance.ts`, `server/auth.ts`, `server/roles.ts`)**: the review store. Roles are
  read from the contract on every privileged call (30 s cache), never from the database. The server holds no curator
  key: an approval is only ever a signature produced in the curator's wallet over a payload the server builds
  deterministically (`buildApproval`), and the contract is the one that enforces it. If this layer is wrong or down,
  nothing unreviewed can become tradable; see `docs/MARKET_GOVERNANCE.md`.
- **Client**: anything financial (stage, balances, claimable, quotes) is read live from the contract. Indexed data
  is used for lists, history, timelines and cost basis.

## Key modules
| Path | Role |
|---|---|
| `lib/chain/config.ts` | the single network/token/deployment config and readiness gate |
| `lib/market/math.ts` | TS mirror of FPMMMath for instant quotes (re-checked on-chain before signing) |
| `lib/market/metadata.ts` | rules schema, canonical serialization, hash, quality and policy review |
| `lib/market/evidence.ts` | evidence document schema and hashing |
| `lib/market/permissions.ts` | role and action availability (presentation only) |
| `lib/governance/proposal.ts` | proposal lifecycle, transitions, input and review-action schemas, checklist |
| `lib/governance/approval.ts` | EIP-712 `MarketApproval` types and domain (must match the contract's typehash) |
| `server/governance.ts` | proposal CRUD, curator actions, approval construction and verification, project verification, audit log |
| `features/governance/*` | suggest wizard, proposal pages, curator dashboard, review and publish panels |
| `lib/market/timeline.ts` | resolution timeline from events plus contract parameters |
| `hooks/useTx.ts` | transaction state machine |
| `server/chain.ts` | server RPC client and chain-time clock |

## Running the indexer
- Local: `INDEXER_MODE=embedded` runs it inside the Next server (PGlite is single-process).
- Production: either the cron route `/api/cron/index` (Bearer `CRON_SECRET`) or the `pnpm indexer` worker against Postgres.

## Data freshness
`/api/health` and `/api/indexer/status` expose lag, last success, errors and reconciliation mismatches. The UI shows a
stale-data notice when the indexer falls behind. Live chain reads keep money-related views correct regardless.
