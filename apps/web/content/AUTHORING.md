# Writing the MEZONK docs

The docs are Fumadocs 15 (MDX) served at `/docs`. Pages live in `content/docs/**`. This file is not published.

## Readers
1. **Traders** who have never used a prediction market or Mezo. They need the plain version first.
2. **Builders and reviewers** (Mezo team, buildathon judges, other Mezo apps) who want exact mechanics, contracts,
   addresses, failure modes and how to verify claims themselves.

Every concept page serves both: a plain explanation first, then the exact detail under a `## How it works exactly`
(or similarly named) section. A reader should be able to stop after the first screen and still be right.

## Hard rules (from the repo's CLAUDE.md, non-negotiable)
- **No fabricated data.** Never invent balances, volumes, users, prices, dates, audits or partnerships. Numbers that
  can change (fees, bonds, windows, seeding rules) are read live: put `<LiveParams />` on the page and, if you give a
  worked example, say which settings it assumes ("today's testnet settings").
- **Say what is live and what isn't.** Exchange `0x4555cfF10200e1007435Cffc683C60683c5C49B9` is live on Mezo testnet
  (chain 31611) since 2026-10-22. Not yet deployed (code merged on GitHub, tested, but not on chain):
  the BTC price resolver (`MezonkPriceResolver`, see docs/PRICE_RESOLVER.md) and the KupiaSec resolution/rebate fixes
  (commit c8fbaff: rebate weight only from in-band seed escrow; anyone may propose after half the proposal window; an
  overturned proposal loses half its bond to the protocol; the proposer can't dispute their own proposal). Describe the
  live contract's behaviour as current and mark the merged-but-not-deployed changes with a `<Callout type="warn"
  title="Next deployment">`. No mainnet deployment exists.
- **Not audited** by an independent firm. Say so plainly where security comes up. Internal review notes exist
  (docs/AUDIT_2026-10-20.md) and an external researcher report (KupiaSec) was received and fixed in code.
- Don't call MEZONK "the first prediction market on Mezo" (Wager, Mezo Hackathon 2, existed).
- Mezo network facts: testnet chain 31611, RPC https://rpc.test.mezo.org, explorer https://explorer.test.mezo.org,
  faucet https://faucet.test.mezo.org, Mezo testnet app https://testnet.mezo.org. MUSD testnet
  `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503`, mainnet `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186`.
  Mezo docs https://mezo.org/docs/developers/. Source code https://github.com/prajalsharma/mezonk.
- If you aren't sure something is true after reading the code, leave it out or write "not verified".

## Voice
- Plain, short, concrete. No hype, no jargon without a one-line definition the first time. "Shares", not "outcome
  tokens". "Back Yes", "sell early", "claim". MUSD is "Mezo's bitcoin-backed dollar".
- Second person ("you"). Active voice. Real UI labels in *italics* exactly as the app shows them (check the code).
- Few em dashes (prefer colons, commas, full stops). No "rule of three" padding, no marketing adjectives
  ("seamless", "robust", "powerful", "revolutionary"), no "In this guide we will".
- Explain *why* a rule exists, not just what it is. Worked numeric examples wherever money moves.
- Headings are sentences in sentence case. No numbered "01 /" section markers, no emoji.

## Page format
```mdx
---
title: Seeding and launch
description: One sentence that says what the reader learns. Shown under the title and in search.
icon: Sprout            # optional, a lucide-react icon name
---

Intro paragraph (2–4 sentences): what this is and why it matters.

## ...
```
Each folder has a `meta.json`: `{ "title": "Get started", "pages": ["quick-start", "get-musd", ...] }`.
End every page with a short `## Next` or `<Cards>` pointing to 2–3 related pages (absolute links: `/docs/...`).

## Components available in MDX (no imports needed)
Fumadocs built-ins:
- `<Callout type="info|warn|error|success" title="...">text</Callout>`
- `<Cards>` + `<Card title="..." href="/docs/..." description="..." />` (use for "next" links and hubs)
- `<Steps>` + `<Step>` (each Step starts with a `### Heading`) for procedures
- `<Tabs items={["Trader", "Builder"]}>` + `<Tab value="Trader">…</Tab>`
- `<Accordions type="single">` + `<Accordion title="Question?">answer</Accordion>` for FAQs
- Fenced code blocks with a title: ```` ```solidity title="MezonkExchange.sol" ```` (copy button is automatic)
- Markdown tables (keep them ≤ 4 columns so they fit on phones)

MEZONK interactive components:
- `<PayoutDemo />` slider: pick a Yes price and a stake, see shares, cost, payout and profit for Yes/No/Invalid.
- `<RatioDemo />` slider: a loan's collateral ratio with Mezo's 110% liquidation line, 150% warning, 200% suggested.
- `<LiveParams />` the live fee, seeding, bond and window values read from the contracts.
- `<Contracts />` the live contract addresses for the configured network, with explorer links.

Architecture diagrams (animated SVG, follow the theme). Put each where it explains the most, with a sentence
before it saying what to look at:
- `<SystemDiagram />` whole system: browser and wallet, Next.js app and API, indexer and database, the four MEZONK
  contracts, Mezo (MUSD, borrowing contracts, PriceFeed), keeper bot.
- `<ContractMap />` the four contracts, what each holds and who may call what; the exchange deploys the other three.
- `<MoneyFlow />` 1 MUSD locked ⇄ 1 Yes + 1 No (split, merge, redeem); where every MUSD sits.
- `<OrderMatching />` one book in Yes-price terms; direct fills vs complement fills (mint / merge), with a 60¢/40¢ example.
- `<MarketLifecycle />` suggested → approved → published (seeding) → live → closed → proposed → (challenged) → final, with the failure exits (failed seeding refunds, missed deadlines → Invalid).
- `<GovernanceFlow />` suggestion → curator EIP-712 signature → creator publishes → contract checks.
- `<ResolutionFlow />` propose with bond + evidence hash → challenge window → finalize, or dispute → arbitrator → final; timeouts → Invalid; who gets each bond.
- `<LoanFlow />` BTC → Mezo trove → MUSD → MEZONK trade → winnings → repay loan → BTC back.
- `<PriceResolverFlow />` close → keeper `settle()` within the capture window → Mezo PriceFeed read → proposal with evidence → challenge window → final.
- `<IndexerPipeline />` getLogs (≤ 9,999 blocks) → chain_events → pure replay → read tables → public API; reorg rewind; reconcile.

## Sources to read before writing (read the code, not just the docs; docs can be stale)
- Product copy and old docs page: `git show HEAD:apps/web/src/app/docs/page.tsx`
- docs/: ORDERBOOK_ARCHITECTURE, MARKET_GRADUATION, INCENTIVE_ECONOMICS, RESOLUTION_DESIGN, RESOLUTION_THREAT_MODEL,
  MARKET_GOVERNANCE, ROLE_MANAGEMENT, SECURITY_AND_SOLVENCY, PRICE_RESOLVER, TESTING_AND_DEPLOYMENT, ARCHITECTURE,
  USER_PROFILES_AND_RBAC_ARCHITECTURE, AUDIT_2026-10-20
- Contracts: `contracts/src/*.sol`; app: `apps/web/src/features/**`, `apps/web/src/lib/**`, `apps/web/src/app/api/**`
