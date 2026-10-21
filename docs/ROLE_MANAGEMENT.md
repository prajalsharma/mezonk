# Role management

Two layers, deliberately not duplicated.

| Role | Authority lives in | Changed by | Takes effect |
|---|---|---|---|
| MEMBER | implicit for any signed-in wallet | — | — |
| ADMINISTRATOR (prompt: PLATFORM_ADMIN) | database (`role_assignments`) | another administrator in `/admin` | immediately; sessions and caches are re-read per request |
| Suspended | database (`accounts.status`) | administrator | immediately; all sessions revoked, every capability removed |
| CREATOR | `MezonkMarketFactory.isCreator` | factory owner signs `setCreator` | when the transaction confirms |
| CURATOR | `MezonkMarketFactory.isCurator` | factory owner signs `setCurator` | when the transaction confirms |
| Resolver, arbitrator, owner | factory / exchange | owner, outside the app | when the transaction confirms |
| Liquidity provider (prompt: MARKET_MAKER) | derived from real escrowed orders | nobody: it's a fact, not a grant | shown in `/admin` wallet inspection |

Why creator and curator are not also database roles: the factory already enforces them for publication, and the
curator approval is verified by the contract. A second database list would be a second, weaker authorization
system that could disagree with the chain. Instead the dashboard edits the on-chain lists through owner-signed
operations, with no source-code change and no redeploy.

Backend permissions are capabilities computed from these facts (`apps/web/src/lib/auth/capabilities.ts`) and
checked on the server for every request (`requireCap`). Role names, wallet addresses and author ids from the
browser are never trusted. Separation: a creator can publish but not review, a curator can review and moderate but
cannot publish or make a market live (only funded seed orders can), an administrator administers but neither
reviews nor publishes, and nobody in the app decides outcomes (that is the market's resolver and arbitrator).

## First administrator (bootstrap)

1. In the host (Vercel), set a **server-only** variable (never `NEXT_PUBLIC_`):
   `INITIAL_ADMIN_WALLETS=0xYourWallet` (comma-separate several). `ADMIN_BOOTSTRAP_WALLET` is still accepted.
2. Deploy, connect that wallet, press **Sign in** (a SIWE signature proves control; no transaction).
3. On that sign-in the wallet becomes ADMINISTRATOR once, recorded by an atomic insert of a durable per-wallet flag
   (`platform_flags`, key `admin_bootstrap:<wallet>`). Signing in again does nothing.
4. The bootstrap closes for good on the first grant or revoke made in `/admin`, or with **Close bootstrap now**
   (Administration → Administrators). Then remove the variable from the host.

Fail-closed: if any entry is not a valid address, nobody is bootstrapped. Unlisted wallets, including the first
wallet ever to connect, get nothing. Break-glass if every administrator is lost: the database owner inserts one
`role_assignments` row by hand with `granted_by = 'break-glass'` and records it in the incident log.

## Granting and revoking

- **Administrator**: `/admin` → Wallets & roles → address → Grant / Revoke, with a reason (audit-logged). You can't
  revoke yourself or the last administrator.
- **Creator / curator**: `/admin` → address → Grant / Revoke next to the on-chain role. This records an operation
  with exact calldata for the **factory**. The owner signs it in their wallet ("Sign with connected owner wallet"),
  or proposes `to` + `data` in a Safe and pastes the transaction hash. The operation reads "confirmed" only after the
  server finds a successful receipt with the matching `CreatorUpdated`/`CuratorUpdated` event from the factory, and a
  fresh contract read shows the new value.
- **Policies** (`/admin` → Policies): propose a new policy version (prefilled from the newest, validated against the
  contract's bounds) or retire/re-enable one. Same owner-signing and confirmation flow, against the **exchange**.

## What needs the database vs. the chain

| Action | Database | On-chain transaction (owner) |
|---|---|---|
| Grant/revoke administrator | yes | no |
| Suspend/restore account, revoke sessions | yes | no |
| Grant/revoke creator or curator | records the request | `factory.setCreator` / `setCurator` |
| Add/retire a graduation-fee policy | records the request | `exchange.addPolicy` / `setPolicyActive` |
| Approve a market | stores the curator's signature | none (the publisher's `createMarket` consumes it) |
| Pause new markets/trading | — | `exchange.pause` |
| Withdraw protocol fees | — | `exchange.withdrawProtocolFees` |

## Compromised wallet

`/admin` → Compromised wallet: suspends the old account, revokes its sessions, moves its administrator role to a
replacement that has signed in itself, withdraws its open suggestions and review claims, and queues owner-signed
creator/curator changes. Its on-chain flags remain until those confirm. Its escrowed orders remain its own: the app
can't move user funds, and neither can the owner.

## Owner keys

Use a multisig (Safe) as owner of both the exchange and the factory. The deploy script transfers ownership with
`Ownable2Step`; the new owner must call `acceptOwnership()` on each. The app never holds a privileged key.
