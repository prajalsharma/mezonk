# Implementation plan and status

| Phase | Status |
|---|---|
| 0. Audit and research | done (initial-audit, competitive-analysis, protocol-design) |
| 1. Foundation: monorepo, tokens, config, DB, API conventions | done |
| 2. Contracts: markets, AMM, resolution, fees, claims, tests | done; not audited |
| 3. Frontend: landing, discover, markets, detail, trade, portfolio, activity, create, docs, status | done |
| 4. Backend: indexer, reorgs, reconciliation, APIs | done |
| 5. Resolution workflows and claims | done |
| 6. Polish: responsive (320–1440), a11y, loading, errors | done; continuing |
| 7. Public testnet deployment | **next**: needs a funded deployer and the owner, arbitrator and resolver addresses |
| 8. Production readiness | not started: audit, multisigs, legal review, monitoring |

Follow-ups: Mezo Passport (BTC wallets) once it supports React 19; a Pyth resolver adapter for automatic price markets;
bundle size on the market page (440 kB first load: recharts and wallet SDKs).
