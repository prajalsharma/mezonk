# Security model

**Not audited.** Automated tools and tests passing is not an audit.

## Custody
User MUSD sits in `MezonkMarkets` (non-upgradeable). Funds leave only through `sell`, `redeem`, `claimLiquidity`,
`claimCreatorFees`, `withdrawBond` (to the entitled caller) and `withdrawProtocolFees` (protocol fee bucket only, owner).

## Privileged powers (complete list)
| Power | Holder | Limits |
|---|---|---|
| `setConfig` | owner | future markets only; fee ≤ 5%; windows bounded (challenge ≥ 1h, all ≤ 30d); dispute bond > 0 |
| `setResolver` | owner | affects which resolvers new markets can choose |
| `pause` / `unpause` | owner | blocks `createMarket`, `buy`, `sell` only |
| `withdrawProtocolFees` | owner | protocol fee bucket only |
| `proposeOutcome` | the market's resolver | once, in the proposal window, with bond and evidence |
| `arbitrate` | the market's arbitrator | only on disputed markets, before the deadline, with a rationale |

All privileged actions emit events (`ConfigUpdated`, `ResolverUpdated`, `Paused`/`Unpaused`, `ProtocolFeesWithdrawn`,
`OutcomeProposed`, `DisputeArbitrated`). Ownership changes use `Ownable2Step`.

## Tooling run (2026-10-19/20)
- Foundry: 61 tests (unit, 22 resolution cases, fuzz with 1,000 runs, 3 stateful invariants × 128 runs × 64 depth), plus a fork test against real MUSD.
- Slither 0.11.4: 16 informational results, none high or medium. Triage: `timestamp` (intended: windows are hours or days long),
  `unused-return` (quote views deliberately ignore pool outputs), `incorrect-equality` (`amount == 0` early return). No action needed.
- TypeScript strict, ESLint, unit, integration and E2E suites (see `testing.md`).
- Secret scan before each push (no `.env`, no keys besides the public anvil test keys in local-only scripts).

## Web
- No server-side private keys. The app never asks for seed phrases.
- Headers: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`.
- User content is rendered as text only; links are https-only with `rel="noopener noreferrer nofollow ugc"`; the server never fetches user URLs.
- Test wallets exist only with `NEXT_PUBLIC_E2E_WALLET=anvil` **and** a localhost RPC.

See [RESOLUTION_THREAT_MODEL.md](RESOLUTION_THREAT_MODEL.md) and [threat-model.md](threat-model.md).
