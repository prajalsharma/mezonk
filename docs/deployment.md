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
| `BLOB_READ_WRITE_TOKEN` | image uploads in production (Vercel Blob). Without it uploads fail with a setup error; the rest of the app works |
| `INITIAL_ADMIN_WALLETS` | the first administrator(s) (see "Roles" below). Remove once the bootstrap is closed |

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

## Roles

Two kinds of role, held in two places. See docs/USER_PROFILES_AND_RBAC_ARCHITECTURE.md.

| Role | Lives in | Changed by |
|---|---|---|
| Administrator | database | another administrator in `/admin`, immediately |
| Creator, Curator | contract | the contract owner signing `setCreator` / `setCurator`; `/admin` prepares and tracks it |
| Owner, Resolver, Arbitrator | contract | the owner, outside the app |

**First administrator.** Set `INITIAL_ADMIN_WALLETS`, redeploy, sign in with that wallet. Each listed wallet is
bootstrapped once; the bootstrap closes on the first grant or revoke in `/admin` (or "Close bootstrap now"). Then
remove the variable. Full procedure: docs/ROLE_MANAGEMENT.md.

**Grant or revoke an administrator.** `/admin` → Wallets & roles → enter the address → Grant/Revoke with a reason.
You cannot revoke yourself or the last administrator.

**Grant or revoke creator/curator.** `/admin` → enter the address → Grant/Revoke next to the on-chain role → this creates
a request against the market factory. If your connected wallet is the factory owner, press "Sign with connected owner wallet". If the owner is a
Safe, copy the `to` and `data` into a Safe transaction, execute it, and paste the hash. The request shows "confirmed"
only after the server finds the successful transaction and reads the new state from the contract.

**Compromised wallet.**
1. Have the person sign in to MEZONK once with a new wallet they control.
2. `/admin` → Compromised wallet → old address, new address, what happened → Start incident response.
   This suspends the old account, signs it out everywhere, moves its administrator role, withdraws its open suggestions
   and releases its review claims.
3. Open the new address in Wallets & roles and have the owner sign the queued creator/curator changes (revoke old,
   grant new). Until they confirm, the old wallet still holds its on-chain flags.
4. If the old wallet was the contract owner, resolver or arbitrator, the owner (or a new owner via `transferOwnership`)
   must rotate it on-chain; the report lists this. Markets it already created keep it as creator.

## Order-book deployment

The current contracts are the order-book exchange set. Deployment steps, gas notes and the testnet checklist are in
docs/TESTING_AND_DEPLOYMENT.md; the old `script/Deploy.s.sol` deploys the v1 AMM and is kept only for reference.
