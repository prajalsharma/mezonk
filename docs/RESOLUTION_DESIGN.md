# Resolution design

How a MEZONK market goes from "trading closed" to "money paid out", who can do what at each step,
and what is enforced on-chain versus shown by the app.

Source of truth: `contracts/src/MezonkMarkets.sol`. Everything below describes that contract.

## 1. Lifecycle

The contract stores no explicit status field. It derives a stage from timestamps and flags
(`MezonkMarkets._stage`), so a stage can never get out of sync with the data:

| Contract stage | Logical lifecycle label(s) shown in the app | Derived from |
|---|---|---|
| `Open` (0) | OPEN | `block.timestamp < closeTime` |
| `Closed` (1) | CLOSED · awaiting proposal / no proposal in time | past close, no proposal |
| `Proposed` (2) | PROPOSED · CHALLENGE_WINDOW open / over | `proposedAt != 0`, no dispute |
| `Disputed` (3) | CHALLENGED · ARBITRATION / arbitration lapsed | `disputedAt != 0` |
| `Finalized` (4) | FINALIZED · CLAIMABLE (Yes/No) or INVALID · refunds open | `finalized == true` |

"Challenge window open vs over" and "arbitration lapsed" are distinctions **within** a contract stage, computed
from deadlines against the latest block timestamp (chain time, never the browser clock).

There is no separate CANCELLED state. Cancellation is the INVALID outcome. It is reached when no proposal
arrives in time, when arbitration lapses, or when the resolver or arbitrator rules Invalid. Invalid
refunds 0.5 MUSD per share of either side.

### Transition table

| From | To | Function | Who | Conditions (all enforced in the contract) | Events |
|---|---|---|---|---|---|
| — | Open | `createMarket` | anyone (pays seed liquidity) | not paused; `minDuration ≤ close − now ≤ maxDuration`; resolver is approved; liquidity ≥ min; 5% ≤ initial prob ≤ 95%; metadata 1–8192 bytes | `MarketCreated` (full metadata + config snapshot) |
| Open | Closed | *(time)* | nobody | `block.timestamp ≥ closeTime`. Closing never sets an outcome | — |
| Closed | Proposed | `proposeOutcome(id, outcome, evidenceHash, evidenceURI)` | the market's **resolver** only | stage = Closed; `now < closeTime + proposalWindow`; outcome ∈ {Yes, No, Invalid}; evidenceHash ≠ 0; pulls `proposerBond` | `OutcomeProposed` (incl. challenge deadline) |
| Closed | Finalized (Invalid) | `finalize` | **anyone** | `now ≥ closeTime + proposalWindow` and no proposal | `MarketFinalized(Invalid, NoProposal)` |
| Proposed | Disputed | `dispute(id, evidenceHash, evidenceURI)` | **anyone except the resolver** | stage = Proposed; `now < proposedAt + challengeWindow`; evidenceHash ≠ 0; pulls `disputeBond`. Only one dispute per proposal | `OutcomeDisputed` (incl. arbitration deadline) |
| Proposed | Finalized | `finalize` | **anyone** | `now ≥ proposedAt + challengeWindow`, no dispute; proposer bond credited back | `BondCredited`, `MarketFinalized(proposed, Undisputed)` |
| Disputed | Finalized | `arbitrate(id, outcome, rationaleHash, rationaleURI)` | the market's **arbitrator** only | stage = Disputed; `now < disputedAt + arbitrationWindow`; outcome ∈ {Yes, No, Invalid}; rationaleHash ≠ 0; both bonds → winner | `BondCredited`, `DisputeArbitrated`, `MarketFinalized(ruling, Arbitrated)` |
| Disputed | Finalized (Invalid) | `finalize` | **anyone** | `now ≥ disputedAt + arbitrationWindow`, no ruling; both bonds refunded | `BondCredited`×2, `MarketFinalized(Invalid, ArbitrationTimeout)` |
| Finalized | — | — | nobody | terminal. `finalize`, `proposeOutcome`, `dispute` and `arbitrate` all revert `WrongStage(Finalized)` | — |

Claims after finalization (`redeem`, `claimLiquidity`, `claimCreatorFees`, `withdrawBond`) change balances, not stage.

## 2. Roles and permissions

All roles are **snapshotted per market at creation** (resolver, arbitrator, windows, bonds, fee). The owner
changing config affects only markets created afterwards.

| Role | Who | Can | Cannot |
|---|---|---|---|
| Visitor | anyone, no wallet | read everything: status, rules, evidence, timeline, claims | sign anything |
| Participant / holder | any wallet; holder = has shares | trade while open, challenge (if not the resolver), finalize when due, redeem when final | propose, arbitrate |
| Resolver | address approved by owner, chosen at creation | propose once, within the proposal window | challenge its own proposal; finalize early; change a proposal |
| Challenger | anyone but the resolver, during the window | file the single challenge with a bond and evidence | challenge after the window, or a second time |
| Arbitrator | protocol-wide address snapshotted into each market | rule once on a disputed market before its deadline | act on undisputed markets; act late; pick an outcome outside Yes/No/Invalid; skip the rationale hash |
| Finalizer | **anyone** | call `finalize` once its deadline condition holds | finalize early (no admin shortcut exists) |
| Creator | market creator | withdraw pool liquidity after finalization (once); claim creator fees anytime | change rules, close early, choose the outcome |
| Claimant | any holder of winning shares (or any shares if Invalid) | `redeem` once, with no deadline | claim twice; claim before final |
| Bond holder | anyone credited a bond | `withdrawBond` | — |
| Owner (admin) | `Ownable2Step` owner, intended to be a multisig | set config for future markets, approve resolvers, pause **creation and trading only**, withdraw **protocol** fees | touch user collateral, creator fees or bonds; propose, rule, or rewrite an outcome; block claims, resolution or bond withdrawals while paused. No upgradeability |

The app computes roles and action availability in one pure function, `apps/web/src/lib/market/permissions.ts`.
It mirrors the contract checks above and returns a plain-language reason for every unavailable action.
It decides only what to show. **The contract is the only authority.**

## 3. Evidence

Every proposal, challenge and ruling commits a `bytes32` hash and a URI on-chain.

- The committed hash is `keccak256` of a canonical **evidence document** (`lib/market/evidence.ts`):
  `{v, kind, marketId, outcome, summary, links[≤5]{url (https), label, sha256?}, author, createdAt}`, serialized with fixed key order.
- Flow: the app POSTs the document to `/api/evidence-documents`. The server stores the canonical bytes and returns hash and URI.
  The client **recomputes the hash itself** before signing. The contract call commits that hash.
- The timeline re-verifies every stored document against its on-chain hash and labels it *verified*, *mismatch* or *missing*.
- Limits: a hash proves what the submitter **said**. It does not prove a linked page still shows the same content.
  The optional per-link SHA-256 is labelled "claimed by submitter" and is not verified. The server never fetches submitted URLs.
- Community evidence (`/api/market-evidence`) is a separate, wallet-signed, unverified comment channel with no effect on settlement.

## 4. Markets with deficient rules

Rules are hashed into the contract at creation and are never added or edited afterwards. If a market's
metadata doesn't match MEZONK's structured schema, or its hash doesn't match, the app marks it
**Deficient resolution rules** and states the policy: the resolver should propose **Invalid** unless the raw
text decides the market unambiguously, and anyone may challenge any other proposal. Markets created through
the MEZONK app always use the structured schema.

## 5. Deadlines and time

- All deadlines are compared with `block.timestamp`. The app uses the latest block timestamp, and the
  server labels stages with chain time (`server/chain.ts: chainNowMs`), so a skewed device clock can't show a wrong state.
- Displayed times are UTC. Each market's rules carry an ISO-8601 UTC `resolvesAt`.
- A transaction mined after a deadline reverts. When less than 10 minutes remain, the UI warns about this.

## 6. Claims and accounting

- Payout per share: winning side 1 MUSD; Invalid 0.5 MUSD on either side (`(yes + no) / 2`, rounded down; dust stays in the market).
- `redeem` zeroes both balances **before** transferring (checks-effects-interactions) under `nonReentrant`, so a second claim reverts `NothingToClaim`.
- The amount shown before signing is the contract's own `claimable(id, account)` read live. Claims charge no protocol fee. There is no claim deadline.
- Solvency invariant (fuzzed): the contract's MUSD balance always equals collateral + creator fees + protocol fees + live bonds + bond credits. Before finalization, YES supply = NO supply = collateral.

## 7. What is on-chain vs indexed vs app-only

| Thing | Where it lives |
|---|---|
| Stage, outcome, deadlines, bonds, balances, claimable amounts | **On-chain** (authoritative; read live by the panel) |
| Rules hash, evidence hashes and URIs, rationale hash | **On-chain** |
| Rules text | On-chain in the `MarketCreated` event; indexed copy verified against the stored hash |
| Evidence documents (full text) | Backend storage, verified against on-chain hashes on every read |
| Timeline, history, P&L, activity | **Indexed** from events; rebuilt from raw logs; reconciled against contract reads |
| Role and action availability, reasons | **App-only** presentation (`permissions.ts`) |
| "Pending claim" list | Browser `localStorage`, settled only by transaction receipts |

## 8. Upgrade and migration

The contract is **not upgradeable** and **not yet deployed to any public network**, so the `arbitrate`
signature change (adding the rationale hash and URI) needs no migration. Any future change ships as a new
deployment: new markets go to the new address, while old markets settle on the old contract, whose
claims never expire. The app would read both via a list of deployments in `lib/chain/config.ts`.

## 9. Test coverage map

| Required case | Test |
|---|---|
| 1–21 | `contracts/test/Resolution.t.sol` (`test_01_…` to `test_21_…`, one per item) |
| 22 fuzz and invariant | `contracts/test/invariant/Invariants.t.sol`, `contracts/test/FPMMMath.t.sol`, `testFuzz_cannotFinalizeEarly` |
| Real MUSD lifecycle | `contracts/test/fork/MezoTestnetFork.t.sol` (fork of Mezo testnet) |
| Duplicate delivery, reorg, RPC failure and retry, lag, timeline, reconciliation | `apps/web/tests/integration/indexer.test.ts` (real anvil chain) |
| Out-of-order events | `apps/web/tests/unit/replay.test.ts` |
| Invalid evidence, unauthorized API calls | `apps/web/tests/unit/routes.test.ts` |
| Role matrix incl. network mismatch | `apps/web/tests/unit/permissions.test.ts` |
| UI per role, claims, keyboard, mobile | `apps/web/tests/e2e/*.spec.ts` (Playwright, real transactions on a local fork) |
