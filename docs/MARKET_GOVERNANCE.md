# Market governance

Who can put a market in front of traders, how a suggestion becomes a live market, and who can never
decide an outcome alone. Companion to `RESOLUTION_DESIGN.md` (what happens after trading closes).

## Why publication is gated

An ambiguous or manipulated question is the main way a prediction market hurts its users. So a connected
wallet cannot publish a market on its own. Every live market has passed an independent review, and the
contract itself refuses to create a market without proof of that review.

## Roles

| Role | How it is granted | What it can do | What it cannot do |
|---|---|---|---|
| **Visitor** | nobody | browse markets, rules, evidence, resolution histories, public suggestions and their status | publish, approve, change an outcome |
| **Community contributor** | any wallet that signs in | submit a market suggestion; edit it while it is a draft or has changes requested; withdraw it; see its review decisions and reasons | make it tradable; approve it |
| **Verified project representative** | claims a project, a curator verifies the claim (public proof link) | everything a contributor can, plus propose markets about their own project with the sponsorship disclosure attached | approve their own market, decide an outcome, edit rules after publication. Verification is a disclosure, not a protocol power |
| **Approved creator** | owner calls `setCreator(wallet, true)` (on-chain) | publish an **approved** proposal by calling `createMarket` with the curator's signature and seeding liquidity | publish anything unapproved; alter approved rules (the approval binds the hash) |
| **Curator / reviewer** | owner calls `setCurator(wallet, true)` (on-chain; may be a Safe via ERC-1271) | claim, approve, reject, request changes, flag duplicates, verify project representatives; every action is logged with a reason | review their own proposal; approve a market they will publish (self-approval reverts on-chain); edit a proposal's content; change outcomes |
| **Resolver** | owner allowlist, chosen per market at creation | propose the outcome after close, with evidence and a bond | finalize without the challenge window; invent outcomes outside Yes/No/Invalid |
| **Challenger** | anyone except the resolver, with the bond | challenge a proposed outcome once | — |
| **Arbitrator** | one address per market, snapshotted at creation | rule on a challenged market before its deadline, with a published rationale | act on unchallenged markets; act late; rewrite a final outcome |
| **Protocol administrator (owner)** | `Ownable2Step` | grant/revoke creator, curator and resolver roles; set parameters for future markets; pause creation and trading; withdraw protocol fees | touch user funds, bonds or creator fees; approve markets; propose, rule or change outcomes; block claims |

A wallet can hold several roles. Conflicts are prevented where they matter: curator ≠ author (backend),
curator ≠ creator for a given publication (contract), resolver ≠ arbitrator (deploy script).

## Lifecycle

```
DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → SCHEDULED → LIVE → CLOSED → RESOLUTION → FINALIZED
                        │   ↑                                                        └→ INVALID
                        ├→ CHANGES_REQUESTED ─(resubmit)┘
                        └→ REJECTED
   any pre-approval state → WITHDRAWN
```

| From → to | By | Conditions | Recorded |
|---|---|---|---|
| draft → submitted | author | structured rules pass validation and policy checks; no blocking issues | review row `submit`, audit |
| submitted → under_review | curator | curator ≠ author | `claim`, `assignedCurator` |
| under_review → changes_requested | curator | reason ≥ 10 chars | `request_changes` + reason (public) |
| changes_requested → submitted | author | after editing (version increments if rules changed) | `resubmit` |
| under_review → rejected | curator | reason ≥ 10 chars; optional duplicate reference | `reject` + reason (public) |
| under_review → under_review (assign) | curator | picks the resolver (must pass `isResolver`) and the publisher (must pass `isCreator`, ≠ curator); defaults: publisher = author | `assign`, audit |
| under_review → approved | curator | full checklist; curator signs the EIP-712 `MarketApproval` for **this version's** rules hash, the publisher, resolver and close time; signature verified server-side (EOA or ERC-1271) | `approve` + checklist; approval stored and public |
| approved → scheduled | creator | optional: records the intended launch | — |
| approved/scheduled → published | **chain** | the publisher calls `createMarket` with the stored approval and seed liquidity; the indexer links `MarketApprovalUsed(nonce)` to the proposal | `publish`, audit |

A suggestion from a wallet that is not an approved creator is still publishable: the curator names an approved
creator as **publisher** before approving, and the approval binds that address. The author keeps authorship on the
proposal page; the publisher owns the on-chain creator role (seed liquidity, creator fees).
| any pre-approval → withdrawn | author | — | `withdraw` |

### Which states the contract enforces

Only the last step is on-chain, but it is the one that matters: `createMarket(params, approval, curator, signature)` reverts unless

1. `msg.sender` is an approved creator (`NotApprovedCreator`);
2. `curator` is an approved curator (`NotCurator`) and `curator != msg.sender` (`SelfApproval`);
3. the approval is unexpired (`ApprovalExpired`) and its nonce unused (`ApprovalUsed`);
4. `approval.metadataHash == keccak256(params.metadata)`, and creator, resolver and closeTime match (`ApprovalMismatch`);
5. the signature verifies for `curator` (`BadApprovalSignature`, ERC-1271 supported).

A curator (or the owner) can void an unused approval on-chain with `cancelApproval(nonce)`, which marks the nonce used (pashov audit 2026-10-20, finding 1).

Everything before that lives in the backend workflow store with an append-only audit log. The backend can
lose data or be wrong about a status, but it can never make an unreviewed market tradable, because it holds
no curator keys. Approved proposals that are never published simply expire (approval deadline ≤ 14 days and
always before the close time would violate the minimum duration).

### After publication

Rules are hashed into the contract and cannot be edited. The only corrections are the resolution process
itself (a deficient market should be resolved Invalid) or, for a market that must not run, the owner pausing
trading protocol-wide. There is no per-market kill switch, deliberately.

## Review standard

A curator approves only when all of the following hold (the checklist is required on approval):

- one objectively checkable answer; a stranger would apply the rules the same way;
- a public primary source, appropriate for the question; fallback handling for missing or revised data;
- an explicit deadline and timezone; trading closes at or before the evaluation time;
- Invalid conditions defined;
- not a duplicate of an open market or a proposal already in review;
- within the market policy (no violence or harm, no private individuals, nothing that rewards illegal acts, nothing unresolvable);
- conflicts disclosed when the proposer or sponsor has a stake in the outcome.

Every decision carries a reason the author can read. Rejection reasons are public on the proposal page.
Internal notes exist but are never exposed.

## Conflicts of interest and sponsorship

- A proposal tied to a project, or submitted by a verified representative, is published with a visible
  "proposed by the project being measured" disclosure.
- Sponsored proposals must include a conflicts statement or they cannot be submitted.
- Curators recuse themselves from proposals they authored (enforced) and should recuse from projects they
  are affiliated with (policy; recorded in the audit log when they do).

## Moderation and appeals

- A rejected author may edit and resubmit; the new version gets a new review and, if approved, a new approval nonce.
- Repeat abuse (spam, policy violations) is handled by rate limits and, if needed, the owner declining to
  approve the author as a creator. There is no wallet ban list in v1.
- Disputes about a **live** market's outcome go through the on-chain challenge and arbitration process, not
  through curation. Curators have no say after publication.
- Anyone can read the audit trail: `/api/audit?type=proposal&id=…` and the proposal page.

## Progressive decentralization

| Phase | Who publishes | Who reviews | Notes |
|---|---|---|---|
| 1 (now) | a small set of approved creators | owner-appointed curators (EOAs or multisigs) | curated launch markets; every step logged |
| 2 | any signed-in wallet can **suggest**; approved creators publish approved suggestions | same curators, plus verified project representatives can propose about their own project | this build implements phase 1 and 2 |
| 3 | contributors with a track record of approved markets become approved creators | automated duplicate detection assists curators; curator set widens | reputation is measured on approved-and-resolved-cleanly markets, not trading profit |
| 4 | optional community curation (e.g. a curator council elected by a governance process) | — | only if adoption and a security analysis justify it. MEZO token voting is **not** planned until the token's actual rights and contracts justify it |

## Known limitations

- The curator set is appointed by the owner. Publication is only as independent as that set.
- The backend workflow is centralised infrastructure. If it is down, nothing new can be reviewed, but nothing on-chain is affected.
- Duplicate detection is a word-overlap heuristic; curators remain responsible.
