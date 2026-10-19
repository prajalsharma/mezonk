# Deployment

Testnet first. Mainnet needs an audit, a legal review and explicit authorization (see `RESOLUTION_THREAT_MODEL.md`).

## Environment keys

### Required to run the app against a deployed contract

| Key | Where | What |
|---|---|---|
| `NEXT_PUBLIC_CHAIN_ID` | web | `31611` (Mezo Testnet) |
| `NEXT_PUBLIC_MARKETS_ADDRESS` | web | the deployed `MezonkMarkets` address |
| `NEXT_PUBLIC_MARKETS_DEPLOY_BLOCK` | web | the deploy block, so the indexer starts there |
| `DATABASE_URL` | server | PostgreSQL connection string (Neon or Supabase free tiers work) |
| `CRON_SECRET` | server | random string protecting `/api/cron/index` |

### Optional

| Key | Why you'd set it |
|---|---|
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | mobile wallets and WalletConnect (free at cloud.reown.com). Without it, browser-extension wallets still work |
| `MEZO_RPC_URL` | private RPC for the indexer if the public one rate-limits |
| `NEXT_PUBLIC_RPC_URL` | a different public RPC for browsers |
| `INDEXER_*` | tuning |

### Only for deploying the contract (your machine, never the web host)

`OWNER`, `ARBITRATOR`, `RESOLVER` (three addresses; arbitrator ≠ resolver), plus a **funded deployer key in a Foundry keystore**.

The app needs **no private keys at all**. Users sign in their own wallets.

## 1. Deploy the contract to Mezo Testnet

Prerequisites:
- The deployer needs testnet BTC for gas: https://faucet.test.mezo.org/
- The resolver needs MUSD for proposal bonds (25 MUSD each by default), and creators need MUSD to seed markets (50 MUSD minimum).
  Borrow MUSD at https://testnet.mezo.org/feature/borrow (minimum debt 1,800 plus a 200 MUSD gas deposit).

```bash
cd contracts
cast wallet import deployer --interactive     # paste the deployer key once; stored encrypted
OWNER=0x… ARBITRATOR=0x… RESOLVER=0x… \
  forge script script/Deploy.s.sol --rpc-url https://rpc.test.mezo.org --account deployer --broadcast \
  --verify --verifier blockscout --verifier-url https://api.explorer.test.mezo.org/api
```

The script refuses to run unless the chain is 31611/31612 and the MUSD address has code, 18 decimals and symbol MUSD.
It prints `MezonkMarkets <address>` and `deployBlock <n>`. If OWNER differs from the deployer, the owner must call `acceptOwnership()`.

## 2. Deploy the web app (Vercel)

1. Import `prajalsharma/mezonk`. Set the root directory to `apps/web`.
2. Set the env keys above.
3. Index on a schedule: point any scheduler (Vercel Cron on Pro, GitHub Actions or cron-job.org) at
   `GET https://<host>/api/cron/index` with `Authorization: Bearer $CRON_SECRET` every minute.
   (Vercel Hobby only allows daily crons, so on Hobby use GitHub Actions or cron-job.org.)
   Alternatively, run the long-lived worker (`pnpm --filter web indexer`) on any Node host with the same env.
4. Migrations run automatically on first database connection.

## 3. Check it

- `GET /api/health` → `ok: true` once the RPC, database and contract are reachable and the indexer is fresh.
- `GET /api/indexer/status` → lag, last error, reconciliation mismatches.

## Local development (no keys, no funds)

```bash
./scripts/dev-chain.sh                 # anvil fork of Mezo Testnet + deploy + fund test accounts; writes apps/web/.env.local
pnpm --filter web dev                  # app + embedded indexer at http://localhost:3000
pnpm --filter web seed:local           # markets in every lifecycle state
```
Pick a "Test wallet: …" in the connect dialog. These only exist on a localhost fork.

## Operations

- **Restart the indexer:** safe at any time; it resumes from its stored cursor.
- **Backfill or rebuild:** `POST /api/markets/:id/refresh` for one market. For a full rebuild, clear `indexer_state` and `chain_events`; the next runs re-index from the deploy block.
- **Reconciliation mismatch:** check `/api/indexer/status`, then refresh the market. Chain data always wins.
- **Pause:** owner calls `pause()`. This stops new markets and trades only; resolution and claims continue.
- **Failed web deploy:** roll back in the host. The contract and user funds are unaffected.
