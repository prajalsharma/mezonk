# Resolution threat model

Scope: proposal, challenge, arbitration, finalization, claims and the evidence/indexing pipeline around them.
Companion to `RESOLUTION_DESIGN.md`. **This system has not been audited.** Passing tests and Slither are not an audit.

## Trust assumptions

| Party | Trusted for | If it misbehaves |
|---|---|---|
| Resolver (approved address per market) | proposing honestly and on time | a wrong proposal can be challenged; silence → market settles Invalid after the proposal window |
| Arbitrator (one address, snapshotted per market) | ruling honestly on disputes | **can decide any disputed market's outcome**. This is the main centralized trust point. Its window is bounded; silence → Invalid with both bonds refunded |
| Owner | config for *future* markets, resolver approvals, pausing new risk, protocol fees | cannot touch collateral, creator fees, bonds or outcomes; cannot block exits. A compromised owner could approve a malicious resolver for new markets or pause trading |
| Indexer / API | convenience: history, timeline, evidence text | can show stale or wrong history, but it **cannot** move funds or change what the contract enforces. The panel reads stage, balances and claimable amounts live from chain |
| MUSD | standard ERC-20 behaviour | address fixed at deploy; fee-on-transfer rejected via balance-delta check |

Recommended production setup: the arbitrator and owner are distinct multisigs (for example Safe on Mezo, at safe.mezo.org), and resolvers are separate keys.
`Deploy.s.sol` refuses arbitrator == resolver.

## Threats

| # | Threat | Impact | Likelihood | Mitigation | Residual |
|---|---|---|---|---|---|
| T1 | Resolver proposes a false outcome | wrong payouts | medium | challenge window (default 1 day), bond slashed to a successful challenger | needs at least one attentive, funded challenger during the window |
| T2 | Arbitrator collusion or capture | wrong final outcome on disputed markets | low to medium | rationale hash required and public; deadline-bounded; per-market snapshot so a later key change can't retarget open disputes | **centralized**. Replace with a multisig, then a decentralized court, behind the same `arbitrator` address slot |
| T3 | Griefing challenges to delay payouts | delays up to the arbitration window | medium | dispute bond (non-zero enforced by config); the loser forfeits it | an attacker willing to lose the bond can still delay one market by up to `arbitrationWindow` |
| T4 | Resolver goes offline | funds stuck | low | permissionless `finalize` → Invalid after the proposal window | Invalid refunds (0.5/share) are not what traders wanted, but nothing is stuck |
| T5 | Arbitrator goes offline | funds stuck | low | permissionless `finalize` → Invalid after the arbitration window, both bonds refunded | as T4 |
| T6 | Resolver self-dispute to steal the disputer role | bond games | — | contract rejects disputes from the resolver | — |
| T7 | Front-running a proposal or dispute | none material | low | one proposal, one dispute; order doesn't change economics; bonds are fixed per market | a challenger racing a deadline may be mined late → revert (UI warns at under 10 min) |
| T8 | MEV on trades near close | worse prices | medium | slippage floor (`minSharesOut` / `minCollateralOut`), deadline parameter, quote re-checked on-chain right before signing | standard AMM exposure |
| T9 | Last-second trading on known outcomes (event resolves before close) | losses for LPs and traders | medium | creation review warns when `resolvesAt` < close; creators should close trading at or before the event | not enforceable on-chain for arbitrary events |
| T10 | Double claim | insolvency | — | balances zeroed before transfer, `nonReentrant`, `NothingToClaim`; covered by tests 18 and 21 and the invariants | — |
| T11 | Reentrancy via token callbacks | theft | low | `nonReentrant` on all state-changing externals; CEI; malicious-token tests | — |
| T12 | Payouts exceed reserves | insolvency | — | complete-set accounting; fuzzed invariants: balance == liabilities, YES = NO = collateral | rounding dust stays in contract (favours solvency) |
| T13 | Owner pauses to trap users | funds stuck | low | `pause` gates only `createMarket`, `buy`, `sell`; resolution, claims and bonds are unaffected (test 20) | — |
| T14 | Evidence link swapped after submission | misleading evidence | medium | document hash committed on-chain; the UI shows hosts and flags a link as "claimed sha256"; arbitrators judge on the committed text | external pages can change; prefer archived or immutable references |
| T15 | Forged evidence documents in the backend | misleading timeline | low | every displayed document is re-hashed and compared with the on-chain hash; mismatches are flagged red | a missing document is shown as missing, never invented |
| T16 | XSS through rules or evidence | account phishing | medium | React escaping only (no `dangerouslySetInnerHTML` on user content); links must be https, without credentials, `rel="noopener noreferrer nofollow ugc"`; strict response headers | — |
| T17 | SSRF via evidence URLs | internal access | — | the server never fetches user URLs | — |
| T18 | API abuse or spam | storage cost | medium | zod validation, size caps (16 KB documents), per-IP rate limits (per instance), signed community evidence | add an edge rate limiter for multi-instance deploys |
| T19 | Indexer reorg / duplicate / out-of-order | wrong history | low on Mezo (CometBFT finality) | unique (chain, tx, logIndex); block-hash check with 64-block rewind; replay sorts events; per-market rebuild from raw logs; reconciliation vs contract reads (integration-tested) | display only; never authoritative |
| T20 | Stale index misleads users | bad decisions | medium | live chain reads for stage and money; stale banner when the indexer lags or fails; "Refresh from chain" re-derives and reconciles | — |
| T21 | Wrong network or token | lost funds | low | single config module; MUSD addresses verified on-chain; deploy script checks code, decimals and symbol; mainnet needs `ALLOW_MAINNET` and `NEXT_PUBLIC_ENABLE_MAINNET` | — |
| T22 | Test wallets leaking into production | key misuse | low | mock connector only when `NEXT_PUBLIC_E2E_WALLET=anvil` **and** the RPC is localhost; keys are the public anvil ones | — |
| T23 | Compromised deployer or owner key | config abuse | low | `Ownable2Step`; transfer ownership to a multisig after deploy | key management is operational, not code |

## Before mainnet

1. An independent security audit of `MezonkMarkets` and `FPMMMath`.
2. Arbitrator and owner as multisigs; publish their signer policies.
3. Decide on a decentralized arbitration path (or a committee) and its upgrade route. Today one address decides disputes.
4. A legal review of prediction-market operation for target jurisdictions.
5. A shared rate limiter and WAF in front of the API; Postgres with backups; error reporting.
6. Monitoring: indexer lag, reconciliation mismatches, markets nearing deadlines with no proposal.
