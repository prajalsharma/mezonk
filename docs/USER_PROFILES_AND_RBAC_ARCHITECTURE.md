# Profiles, slugs, media, comments and RBAC — architecture

Status: implemented on 2026-10-20 (see "Implementation status" at the end for what is verified vs not).

## 1. Current state (audited 2026-10-20)

| Area | What exists | Gap |
|---|---|---|
| Stack | Next.js 15 App Router route handlers, Drizzle ORM, PGlite locally / Postgres in prod, zod, wagmi/viem, Foundry contracts | — |
| Wallet auth | `/api/auth/nonce` → EIP-4361 message → `/api/auth/session` verifies with viem `verifyMessage`, nonce single-use and 10-minute TTL (`auth_nonces`) | Session was a **stateless HMAC bearer token** in sessionStorage: not revocable, readable by page JS, no logout server-side |
| Roles | `server/roles.ts` reads **on-chain** `owner`, `isCurator`, `isCreator`, `isResolver`, `config.arbitrator` from `MezonkMarkets`; project representatives in DB | No platform administrator, no suspension, no capability layer (checks were `roles.curator` inline) |
| Contract access control | `Ownable2Step` owner; `setCreator`, `setCurator`, `setResolver` are `onlyOwner`; curator approvals are EIP-712 signatures checked in `createMarket`; `cancelApproval(nonce)` | Contract is **not upgradeable**; there is no OpenZeppelin `AccessControl`, only the owner + three boolean maps |
| Market lifecycle | Proposals (`market_proposals`, reviews, audit log) → curator EIP-712 approval → approved creator calls `createMarket` → indexer links `MarketApprovalUsed` | — |
| Market identity | `markets.market_id` (on-chain id) is the PK; URLs are `/markets/{id}` | No slugs |
| Profiles | `user_settings.display_name` only | No username, avatar, bio, profile page by handle |
| Media | None | No storage |
| Comments | None (only signed community *evidence*) | — |
| Audit | `audit_log` table, append-only by convention | Not enforced by the database |

## 2. Trust boundaries

```
 Browser ── signs SIWE ──▶ API (route handlers) ──▶ Postgres        (platform truth: profiles, sessions, comments,
    │                         │                                       media, proposals, admin roles, audit)
    │                         └── reads ──▶ MezonkMarkets (Mezo)    (protocol truth: owner, creator, curator,
    └── signs txs ───────────────────────▶ MezonkMarkets              resolver, arbitrator, markets, funds)
```

- The server never trusts a wallet, role or author id from the request body. The wallet comes from a server-side session
  created by a verified signature; protocol roles come from contract reads; platform roles from `role_assignments`.
- The server holds **no protocol keys**. Every on-chain role change is signed by the contract owner (EOA or Safe) in its
  own wallet. The backend only records the operation and verifies the receipt and resulting chain state.

## 3. Data model (migration `0004_profiles_rbac_media_comments`)

| Table | Purpose | Key constraints |
|---|---|---|
| `sessions` | server-side wallet sessions | PK = sha256(token); index on wallet; `revoked_at` |
| `accounts` | per-wallet status (`active` / `suspended`) | PK wallet |
| `profiles` | display name, handle, bio, avatar | PK wallet (stable identity); `username_normalized` UNIQUE; avatar FK `media` |
| `role_assignments` | platform roles (`ADMINISTRATOR`) | partial UNIQUE (wallet, role) where not revoked; rows never deleted |
| `role_operations` | on-chain `setCreator`/`setCurator` requests and their transactions | `tx_hash` UNIQUE; status machine |
| `wallet_replacements` | compromised-wallet incidents and what was done | append-only |
| `media` | uploaded image metadata (bytes live in object storage) | owner, status, sha256 |
| `proposal_media` | cover + context images on a proposal (carried to the published market) | PK (proposal, media); FKs cascade |
| `market_slugs` | public slugs | PK slug (global uniqueness); partial UNIQUE (market) where current; FK markets |
| `comments` | discussion on a market | FK markets (cascade on reorg removal only); index (market, id) |
| `comment_reports` | reports | UNIQUE (comment, reporter) |
| `market_proposals.summary` | short off-chain summary | — |
| trigger `audit_log_append_only` | rejects UPDATE/DELETE on `audit_log` | database-enforced |

Usernames are not identities: everything references the wallet. Migrations are additive (no drops, no data rewrites).

## 4. Roles and capabilities

Roles: **MEMBER** (any signed-in, non-suspended wallet), **CREATOR** (on-chain `isCreator`), **CURATOR** (on-chain
`isCurator`), **ADMINISTRATOR** (platform, `role_assignments`), plus the protocol **OWNER** (on-chain `owner()`), which is
not a platform role and is never granted by the app. No inheritance between roles: capabilities are the union of what
each held role grants (`lib/auth/capabilities.ts`).

| Capability | MEMBER | CREATOR | CURATOR | ADMIN |
|---|---|---|---|---|
| `profile:update:self`, `comment:create`, `comment:edit:own`, `comment:delete:own`, `comment:report`, `media:upload`, `market:submit` (suggest) | ✓ | ✓ | ✓ | ✓ |
| `market:publish` (needs on-chain creator **and** a curator approval) | | ✓ | | |
| `market:review` (claim/approve/reject/request changes; never own proposals) | | | ✓ | |
| `comment:moderate`, `media:moderate`, `project:verify` | | | ✓ | ✓ |
| `role:grant:admin`, `role:revoke:admin`, `account:suspend`, `account:restore`, `session:revoke:any`, `wallet:replace`, `role:operation:create` (record on-chain creator/curator changes), `audit:read` | | | | ✓ |

Resource rules on top (server-side): own profile only; own comments only for edit/delete; curator ≠ proposal author;
an administrator cannot revoke or suspend themselves, and the last active administrator cannot be revoked.

## 5. Wallet authentication

1. `GET /api/auth/nonce?wallet=` → 128-bit random nonce, 10-minute expiry, EIP-4361 message bound to the request host,
   URI, chain id, nonce, issued-at.
2. Wallet signs; `POST /api/auth/session` verifies the signature for that address (EOA; ERC-1271 via viem when the
   address has code) and **atomically consumes** the nonce (`UPDATE … WHERE used_at IS NULL RETURNING`).
3. Server creates a session row and sets an **HttpOnly, SameSite=Lax, Secure (prod), `__Host-`** cookie holding a
   256-bit token; only its SHA-256 is stored. 7-day expiry.
4. Every authenticated request looks the session up, checks expiry/revocation and account status.
   State-changing requests must carry an `Origin` matching the host (CSRF).
5. `DELETE /api/auth/session` revokes the session. Switching wallets in the extension signs the old one out client-side
   and the server rejects the old cookie for the new address.

## 6. Role assignment and compromised-wallet recovery

- **Platform roles** (ADMINISTRATOR): granted/revoked in `/admin`, audited, effective immediately (role cache cleared).
- **Protocol roles** (CREATOR, CURATOR): held by `MezonkMarketFactory`. The admin records an operation in `/admin`; the factory owner signs
  `setCreator`/`setCurator` in their wallet (or proposes it in their Safe); the app submits the hash; the server checks the
  receipt (to = market contract, from = owner, calldata matches, status success) **and** re-reads `isCreator/isCurator`
  before marking it `confirmed`. Nothing is reported as done before that.
- **Bootstrap:** see docs/ROLE_MANAGEMENT.md. `INITIAL_ADMIN_WALLETS` (or legacy `ADMIN_BOOTSTRAP_WALLET`), durable
  per-wallet flags in `platform_flags`, closes on the first routine grant/revoke, fails closed on malformed config.
- **Compromised wallet** (`POST /api/admin/wallets/replace`): suspend old account → revoke all its sessions → revoke its
  platform roles → withdraw its unapproved proposals and release its review claims → grant the same platform roles to
  the replacement (which must have signed in itself) → create pending on-chain operations to revoke the old wallet's
  creator/curator flags and grant them to the new one → write an incident record and audit entries → return a report of
  what is done vs. pending. Published markets keep their original creator; the contract fixes `m.creator` forever.

## 7. Images

Upload: `POST /api/media` (multipart, ≤ 5 MB) → magic-byte check (PNG, JPEG, WebP, GIF; SVG rejected) → decoded and
**re-encoded to WebP** by `sharp` (strips metadata, defeats polyglots, caps 2048 px; avatars 512 px square) → stored
under a random key through the `StorageProvider` boundary (`vercel-blob` when `BLOB_READ_WRITE_TOKEN` is set, else
`local` disk in development; in production with neither configured, uploads fail with a setup error). Rows start
`pending` and become `attached` when bound to a profile or proposal by their owner; pending rows older than 24 h are
deleted by the cron route. Local files are served by `/api/media/{id}` with `nosniff`, `Content-Security-Policy:
sandbox`, and a fixed `image/webp` type. Curators/admins can remove media (`removed`, audited).

## 8. Comments

`GET/POST /api/markets/{id}/comments` (cursor pagination by id), `PATCH/DELETE /api/comments/{id}` (own only),
`POST /api/comments/{id}/report`, `POST /api/comments/{id}/moderate` (hide/restore, curators/admins, reason required).
Plain text only (≤ 2,000 chars, control characters stripped), rendered as text by React: no HTML, no markdown. Limits:
6 comments per minute per wallet, identical body within 10 minutes rejected. Deletion is soft. Comments reference the
numeric market id, never the slug.

## 9. Slugs

Policy **A: immutable after creation.** `slugify(question)` (NFKD, strip marks/emoji/punctuation, lowercase, hyphens,
≤ 72 chars at a word boundary; empty → `market-{id}`); collision → `{base}-{id}`. Assigned by the indexer after a market
row exists (and backfilled for existing markets on the next indexer tick — no destructive migration). `/markets/{slug}`
is canonical; `/markets/{id}` permanently redirects to it. Unknown slug → 404. The slug table is never touched by market
replay, so reindexing cannot change a URL.

## 10. Threats and mitigations

| Threat | Mitigation |
|---|---|
| Signature replay | single-use nonce consumed atomically; host and chain id in the message |
| Session theft via XSS | HttpOnly cookie; no token in JS; plain-text rendering of all user content |
| CSRF | SameSite=Lax + Origin check on mutations |
| Privilege escalation | capabilities computed server-side from chain + DB; admin endpoints require `role:*`; self-revoke/last-admin guards; bootstrap only when zero admins |
| Compromised admin | suspension revokes sessions and roles at once; append-only audit trigger; protocol ownership stays with the owner key/Safe, not the app |
| Backend/chain drift | creator/curator truth is read from chain on every privileged call (30 s cache, cleared on change); operations confirm only after receipt + state read |
| Malicious images | magic bytes, re-encode, size/dimension caps, SVG rejected, sandboxed serving |
| Spam | per-wallet and per-IP rate limits, duplicate throttling, reports, moderation |
| Slug squatting | slugs only assigned by the indexer from on-chain questions |

## 11. Tests

`tests/unit/rbac-slug-media.test.ts` (capability matrix, slugs, magic bytes, text rules),
`tests/unit/platform.test.ts` (in-memory PGlite: nonce reuse/expiry, wrong signer, logout, suspension kills sessions,
role escalation, last-admin guard, bootstrap, comment ownership/moderation/XSS/pagination, slug uniqueness, audit
immutability, role-operation honesty), plus E2E for the profile + comment journey.

## 12. Outstanding infrastructure

- `AUTH_SECRET` is no longer used (sessions are DB-backed random tokens) and was removed from `.env.example`.
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob) or another provider for production uploads.
- `INITIAL_ADMIN_WALLETS` for the first administrator(s).
- `NEXT_PUBLIC_APP_ORIGIN` is not required: origin checks use the request host.
- The contract owner should be a Safe. The app can display calldata for a Safe proposal but cannot execute it.
- Rate limits are in-memory per instance; use an edge limiter for multi-instance production.
