# Testing

| Suite | Command | What it covers |
|---|---|---|
| Contracts | `cd contracts && forge test` | unit; `Resolution.t.sol` cases 1–21 (one per required case); fuzz (k monotonic, no round-trip profit, early finalize); invariants (balance == liabilities, Yes = No = collateral, finality) |
| Fork | `MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*'` | full lifecycle against the real MUSD bytecode |
| Unit | `cd apps/web && pnpm test` | AMM mirror, replay (incl. out-of-order), permissions per role, timeline, metadata and policy review, API auth and validation |
| Integration | `pnpm test:integration` | indexer on a real anvil chain: lifecycle, duplicate delivery, reorg, RPC failure and retry, lag, divergence detection and repair |
| E2E | `pnpm test:e2e` (local fork stack running) | per-role resolution flows, claim once, rejected signature, on-chain revert, create wizard (blocking checks and publish), keyboard, no overflow at phone width on 10 pages |

Unit tests use hand-built test doubles (labelled). Integration and E2E use real chains and real transactions.

## Last results (2026-10-20)
- Contracts: 61 passed, plus fork 1 passed.
- Unit: 33 passed. Integration: 6 passed.
- E2E: 23 passed (desktop and mobile projects) against the local fork stack.

Not covered: real wallet extensions (E2E uses a mock connector signing through anvil), and mainnet.
