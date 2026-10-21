# Testing

| Suite | Command | What it covers |
|---|---|---|
| Contracts | `cd contracts && forge test` | unit; `Resolution.t.sol` cases 1–21 (one per required case); fuzz (k monotonic, no round-trip profit, early finalize); invariants (balance == liabilities, Yes = No = collateral, finality) |
| Fork | `MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*'` | full lifecycle against the real MUSD bytecode |
| Contracts (governance) | `forge test --match-contract Governance` | 15 cases: cancelApproval, unapproved creator, non-curator, self-approval, expiry, replay, every field of the hash binding, ERC-1271 curator, revoked curator, fuzz: random keys never approve |
| Unit | `cd apps/web && pnpm test` | AMM mirror, replay (incl. out-of-order), permissions per role, timeline, metadata and policy review, API auth and validation, proposal lifecycle (transitions, final states, who may trigger what), review-action and proposal schemas, EIP-712 type layout |
| Unit (platform) | `pnpm test` | `rbac-slug-media` + `platform` (in-memory Postgres): sign-in replay/expiry/forged/other-address, logout, cross-origin cookie writes, profile uniqueness and reserved names, admin bootstrap once, privilege escalation by members/curators, self-revoke and last-admin guards, concurrent grants, suspension kills sessions, role operations only confirmed from chain, wallet replacement, slug uniqueness and redirects, image spoofing/SVG/oversize, comment XSS/ownership/moderation/pagination/rate limits, append-only audit log |
| Integration | `pnpm test:integration` | indexer on a real anvil chain: lifecycle, duplicate delivery, reorg, RPC failure and retry, lag, divergence detection and repair |
| E2E | `pnpm test:e2e` (local fork stack running) | per-role resolution flows, claim once, rejected signature, on-chain revert; governance: blocking wording, suggest → curator signs approval → publisher creates on-chain → indexer links, non-publisher rejected in the UI and on-chain, approval replay reverts, request-changes → resubmit as v2 with public reason; keyboard; no overflow at phone width on 13 pages |

Unit tests use hand-built test doubles (labelled). Integration and E2E use real chains and real transactions.

## Last results (2026-10-20)
- Contracts: 78 passed (+ 1 fork test, skipped without `MEZO_TESTNET_RPC_URL`).
- Unit: 44 passed. Integration: 6 passed.
- E2E: 27 passed (desktop and mobile projects) against the local fork stack.

Not covered: real wallet extensions (E2E uses a mock connector signing through anvil), and mainnet.
