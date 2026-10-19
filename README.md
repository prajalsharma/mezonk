# MEZONK

**Turn your conviction into a market.** An independent, non-custodial prediction market on [Mezo](https://mezo.org), settled in MUSD.
Not affiliated with or endorsed by Mezo.

- Buy **Yes** or **No** shares with MUSD; sell back any time before trading closes.
- Every Yes/No pair is backed by exactly 1 MUSD held by the contract, so payouts can't exceed reserves.
- Rules are hashed on-chain at creation and can't be edited.
- Outcomes go through a public **propose → challenge → arbitrate** process with evidence committed on-chain. If nobody acts in time, markets settle as **Invalid** (0.5 MUSD per share) and nothing gets stuck.

> Status: **testnet-ready, not deployed to a public network yet, not audited.** Local fork end-to-end is fully working.

## Layout

```
contracts/      Foundry: MezonkMarkets (FPMM over complete sets + optimistic resolution), tests, deploy script
apps/web/       Next.js 15 app + API routes + event indexer (Drizzle: Postgres in prod, PGlite locally)
docs/           Design, threat model, deployment
scripts/        dev-chain.sh (local Mezo fork)
```

## Quick start (local fork, no funds or keys needed)

```bash
pnpm install
./scripts/dev-chain.sh            # terminal 1: anvil fork of Mezo Testnet, deploys and funds test wallets
pnpm --filter web dev             # terminal 2: http://localhost:3000
pnpm --filter web seed:local      # terminal 3: markets in every lifecycle state
```

## Tests

```bash
cd contracts && forge test                                   # unit, resolution (1–21), fuzz, invariants
MEZO_TESTNET_RPC_URL=https://rpc.test.mezo.org forge test --match-path 'test/fork/*'   # real MUSD on a fork
cd apps/web
pnpm test                 # unit: AMM math, replay, permissions, timeline, API auth
pnpm test:integration     # indexer vs a real anvil chain: reorg, duplicates, RPC failure, reconciliation
pnpm test:e2e             # Playwright vs the local fork stack (start dev-chain + app first)
```

## Deploying

See [docs/deployment.md](docs/deployment.md) for env keys, testnet deploy and hosting.

## Docs

- [Resolution design](docs/RESOLUTION_DESIGN.md): lifecycle, transition table, roles, evidence, claims
- [Resolution threat model](docs/RESOLUTION_THREAT_MODEL.md)
- [Deployment](docs/deployment.md)
- [Protocol design](docs/protocol-design.md), [Economics](docs/economics.md), [Architecture](docs/architecture.md)
- [Security model](docs/security-model.md), [Threat model](docs/threat-model.md), [Testing](docs/testing.md)
- [Competitive analysis](docs/competitive-analysis.md)

## License

MIT. See [LICENSE](LICENSE).
