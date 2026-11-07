# Monthly markets

`apps/web/scripts/import-markets.ts` (`pnpm --filter web import:markets`) lists new markets every month on its own:

- **Bitcoin price markets** (3 by default): point-in-time "BTC at or above $X at time T" questions, settled on Mezo's
  own BTC price by `MezonkPriceResolver`.
- **Two picks beyond Bitcoin**: drawn at random from the 20 most traded open questions that qualify, settled by an
  allowlisted resolver wallet from the official source named in their rules.

Questions are found on the public Polymarket (Gamma) and Kalshi APIs. **Public text never names them**: not the
question, rules, description, summary, rationale, references or review reasons. The source market id is kept only
in the proposal's private seeding-plan field (`liquidityPlan`, visible to its author and curators) as
`[source polymarket:<slug>]`, which the script uses later to find the result. Tests assert this.

Code: `src/lib/import/external.ts` (API parsers, source tags, final results), `src/lib/import/btc.ts` (Bitcoin
questions), `src/lib/import/events.ts` (picks beyond Bitcoin), tests in `tests/unit/import-markets.test.ts`.

## What qualifies

**Bitcoin:** only point-in-time questions (Polymarket "Bitcoin above ___ on <date>", Kalshi `KXBTCD` strikes). Mezo's
PriceFeed has no history, so the resolver reads it once after close. Skipped with a reason: any-time-before questions
("reach $X in November", Kalshi `KXBTCMAXY`), ranges (Kalshi `KXBTC`), up/down questions (that's `docs/BTC_ROUNDS.md`).
The same moment and strike on both sources counts once; at most 2 per moment.

**Beyond Bitcoin** (Polymarket only, since its markets name a resolution source URL): a `"Yes" if …` sentence in the
rules; an https `resolutionSource` that isn't another prediction market; no crypto; no sentence-level dependence on the
original site (sentences mentioning Polymarket, UMA, clarifications etc. are dropped, and the question is skipped if
the Yes condition itself depends on them); the rewritten rules pass `metadataSchema` and `reviewMetadata` (which
includes the harm policy). One per event, so a 30-question event doesn't crowd out the rest.

**Both:** Yes between 10% and 90%; ends between seeding + minimum live time + 1 day and 45 days out; not already on
MEZONK (exact question text, markets and live proposals).

## What a run does

1. **Plan** (always, no keys): reads policy and factory config from the chain, fetches, chooses, prints every pick with
   its rules, source and seed orders, and writes `monthly-markets-plan.json`.
2. **Publish** (`IMPORT_PUBLISH=1`), per market: creator suggests → curator claims, assigns the resolver (price
   resolver or event resolver) and the creator as publisher → curator signs the server-built EIP-712 approval after
   checking its hash, resolver, publisher, close time and policy → creator publishes → (Bitcoin) curator records the
   strike with `setRule` → creator seeds a Yes bid and a No bid 6¢ apart around the found price → `graduate()` if the
   policy is already met.
3. **Earlier markets**, on every publish run: `graduate()` the ones whose seeding is complete, and for ended picks
   beyond Bitcoin, once the original question has a final result (Polymarket: closed, `umaResolutionStatus`
   resolved, prices 1/0), propose Yes/No from the resolver wallet with the official source URL as evidence URI. That
   proposal has a bond and a challenge window like any other. If the original never settles, nothing is proposed and
   the market ends Invalid at its deadline.

Resumable: a re-run picks up half-finished proposals and only places missing orders. One failing market doesn't stop
the batch. With policy #1 (2 distinct seeders) markets wait for an outside seeder; the script never fakes one.

## Missed deadlines (why the first three testnet markets show "No outcome proposed")

Markets #1–#3 on testnet (Fed, BTC $85k, House) closed on Oct 28, Oct 31 and Nov 3. Their resolver
`0xBC67E6CB507833f32227cAbAFED451D832525bC2` never proposed, and each 3-day proposal window has passed (last one
Nov 6 23:00 UTC). The contract now allows only one thing: anyone calls `finalize(id)` on MezonkResolution
`0x6Da57dDd874f02E3ad704F75aCC86D0319d3b944`, and the market settles **Invalid** (every share redeems for 0.50 MUSD).
An eth_call of `finalize` succeeds for all three (checked 2026-11-07).

The keeper now does this automatically (`finalizePass` in `scripts/market-maker.ts`, on by default, `MM_FINALIZE=0`
to turn off): any launched market whose deadline passed (no proposal, unchallenged proposal, lapsed arbitration) is
finalized after an eth_call shows it will succeed. Manually: open the market → *Resolution* → *Finalize*, or
```
cast send 0x6Da57dDd874f02E3ad704F75aCC86D0319d3b944 "finalize(uint256)" 1 --account <any> --rpc-url https://rpc.test.mezo.org
```

## Before the first run (owner, once)

1. Deploy the price resolver owned by the import curator and allowlist it (`docs/PRICE_RESOLVER.md`), and fund it with
   MUSD for proposer bonds (25 MUSD per market).
2. Wallets: **import curator** (`factory.setCurator`, owns the price resolver), **import creator**
   (`factory.setCreator`, holds seeding MUSD; must differ from the curator), **event resolver** (`factory.setResolver`,
   holds MUSD for bonds; must differ from the arbitrator).
3. Gas (test BTC) in all three. Seeding is about 0.94 × the policy depth in MUSD per market; the plan prints the total.
4. Keeper on Render with `MM_PRICE_RESOLVER=<resolver>` (settles Bitcoin markets) and finalizing on (default).
5. `NEXT_PUBLIC_PRICE_RESOLVER` in Vercel.

## Running it

```sh
pnpm --filter web import:markets                      # look first
IMPORT_PUBLISH=1 PRICE_RESOLVER=0x… IMPORT_EVENT_RESOLVER=0x… \
  CURATOR_ACCOUNT=import-curator CREATOR_ACCOUNT=import-creator RESOLVER_ACCOUNT=import-resolver \
  pnpm --filter web import:markets
```

Unattended (Render Cron Jobs from this repo, build `pnpm install --frozen-lockfile`):

| Job | Schedule (UTC) | Command |
|---|---|---|
| Monthly listing | `0 14 1 * *` | `IMPORT_PUBLISH=1 pnpm --filter web import:markets` |
| Daily launch + outcomes | `0 15 * * *` | `IMPORT_PUBLISH=1 IMPORT_LIMIT=0 IMPORT_EVENTS=0 pnpm --filter web import:markets` |

Secret env for both: `PRICE_RESOLVER`, `IMPORT_EVENT_RESOLVER`, `IMPORT_CURATOR_KEY`, `IMPORT_CREATOR_KEY`,
`IMPORT_RESOLVER_KEY` (never `NEXT_PUBLIC_`); optionally `APP_URL`.

| Variable | Default | Meaning |
|---|---|---|
| `IMPORT_LIMIT` | 3 | Bitcoin markets per run |
| `IMPORT_EVENTS` | 2 | picks beyond Bitcoin per run |
| `IMPORT_EVENT_POOL` | 20 | random draw from this many most-traded qualifying questions |
| `IMPORT_MAX_DAYS` | 45 | latest end date |
| `IMPORT_MIN_TRADE_HOURS` | 24 | trading time after seeding |
| `IMPORT_MIN_PROB` / `IMPORT_MAX_PROB` | 0.1 / 0.9 | |
| `IMPORT_PER_MOMENT` | 2 | Bitcoin markets sharing one moment |
| `IMPORT_SOURCES`, `IMPORT_KALSHI_SERIES` | both; `KXBTCD,KXBTC,KXBTCMAXY,KXBTCMINY` | |
| `IMPORT_SNAPSHOT` | | saved responses `{ "polymarket", "top", "kalshi" }` instead of fetching |

## Trust and risks

- **The curator and resolver keys on a host are automated roles.** Use wallets that hold nothing else, revocable with
  `setCurator(w, false)` / `setResolver(w, false)`.
- **Picks beyond Bitcoin carry rewritten third-party rules.** The automated checks catch format, policy and site
  wording, not every ambiguity. Rules are immutable once published; a bad one is resolved Invalid through the normal
  process. Read the plan's printed rules before turning on the cron job, and consider `IMPORT_EVENTS=0` until you're
  comfortable.
- **Outcomes for picks follow the original market's final result**, cited against the named official source. A wrong
  one can be challenged and the arbitrator rules.
- **Source formats can change.** Parsers check every field and skip what they don't recognise, with a reason.

## Verified

- Unit tests (20): parsers, final results, private source tag, every skip rule, random draw, rules text (schema and
  review checks), public text free of source names, seed prices.
- Local fork (2026-11-07, Bitcoin path): published, ruled and seeded 3 markets; re-run skipped them and launched the one
  that gained a second seeder. Keeper dry run against testnet: would finalize markets #1–#3.
- **Not verified:** live Polymarket/Kalshi responses (the development sandbox couldn't reach them) and the
  beyond-Bitcoin path against a real Gamma payload. Run the plan from a normal machine first.
