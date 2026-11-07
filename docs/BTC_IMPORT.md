# Monthly Bitcoin market import

`apps/web/scripts/import-btc-markets.ts` (`pnpm --filter web import:btc`) finds the most traded Bitcoin price
questions on Polymarket and Kalshi and lists the same questions on MEZONK. The new markets settle on Mezo's own BTC
price through `MezonkPriceResolver`, and the importer seeds them. It is meant to run once a month, with a small daily
run that launches markets once their seeding is complete.

Code: `src/lib/import/external.ts` (API parsers), `src/lib/import/btc.ts` (what qualifies, ranking, rules text,
seed prices), tests in `tests/unit/import-btc.test.ts`.

## What gets imported

Only **point-in-time** questions: "BTC at or above $X at time T" (Polymarket's "Bitcoin above ___ on <date>",
Kalshi's `KXBTCD` "above" strikes). Mezo's PriceFeed has no history, so the resolver reads the price once, right
after close, and that reading can only answer a question about that moment.

Skipped, with the reason printed:

| Kind | Example | Why |
|---|---|---|
| Any time before a date | "Will Bitcoin reach $130,000 in November?", Kalshi `KXBTCMAXY` | needs the highest price over a period; the feed can't give that |
| Ranges | Kalshi `KXBTC` "$121,000 to 121,499.99" | the resolver handles a single strike |
| Up or down | "Bitcoin Up or Down on Nov 7?" | that's the BTC up/down rounds (`docs/BTC_ROUNDS.md`) |
| Too one-sided | Yes below 10% or above 90% | doesn't trade |
| Too soon or too far | measured before seeding + 1 day of trading, or more than 45 days out | |
| Already listed | same question text on MEZONK | monthly runs never duplicate |

The same moment and strike on both sources counts as one question; the busier one is used. At most 2 markets per
moment and 3 per run by default.

### What changes from the source market

The MEZONK question is written fresh, for example *Will Bitcoin be at or above $120,000 on Mezo's price feed at
17:00 UTC, Nov 30, 2026?* It closes at the source's measurement time and settles on Mezo's PriceFeed, not on the
source's exchange price (Polymarket uses Binance BTC/USDT, Kalshi uses the CF Benchmarks BRTI). The description
says this, and that the two can resolve differently if Bitcoin ends within a few dollars of the strike. The source
market is linked from the proposal's references (label `polymarket:<slug>` or `kalshi:<ticker>`).

## What a run does

1. **Plan** (always, no keys needed): reads the current policy and factory config from the chain, fetches both
   sources, filters and ranks, prints the picks with their seed orders and the MUSD needed, and writes
   `btc-import-plan.json`.
2. **Publish** (only with `IMPORT_PUBLISH=1`), per market, through the normal governance path:
   creator suggests → curator claims, assigns the price resolver and the creator as publisher → curator signs the
   EIP-712 approval the server builds (the importer checks its hash, resolver, publisher, close time and policy
   first) → creator publishes → curator records the strike with `setRule` → creator places a Yes bid and a No bid
   around the source's price (6¢ apart, the policy's minimum depth, enough escrow to count as a seeder) →
   `graduate()` if the policy is already met.
3. **Launch earlier imports**: every publish run also tries `graduate()` on earlier imported markets still in
   seeding. Policy #1 needs 2 distinct seeders, so imports wait there for someone else to seed. That's deliberate:
   the importer will not fake a second seeder with a second wallet of its own.

Every step is resumable: a re-run picks up a half-finished proposal and only places missing seed orders. One failing
market doesn't stop the batch.

## Before the first run (owner, once)

1. Deploy the price resolver, owned by the wallet that will act as the import curator, and allowlist it
   (`docs/PRICE_RESOLVER.md`): `RESOLVER_OWNER=<curator> EXCHANGE=… forge script script/DeployPriceResolver.s.sol …`,
   then `factory.setResolver(<resolver>, true)` and fund it with MUSD for proposer bonds (25 MUSD per market).
2. Two wallets: an **import curator** (`factory.setCurator`) that also owns the resolver, and an **import creator**
   (`factory.setCreator`). They must differ; the factory rejects self-approval.
3. Fund the creator with test BTC for gas and MUSD for seeding. Seeding needs about 0.94 × the policy's depth in MUSD
   per market (about 19 MUSD on policy #2, 94 MUSD on policy #1); the plan prints the exact total.
4. Run the keeper with `MM_PRICE_RESOLVER=<resolver>` so markets get settled after close.
5. Set `NEXT_PUBLIC_PRICE_RESOLVER` in Vercel.

## Running it

```sh
# Look first. No keys, nothing written on-chain.
pnpm --filter web import:btc

# Publish from this machine with Foundry keystores (passwords asked once).
IMPORT_PUBLISH=1 PRICE_RESOLVER=0x… CURATOR_ACCOUNT=import-curator CREATOR_ACCOUNT=import-creator \
  pnpm --filter web import:btc
```

Unattended (Render Cron Job, from this repo, build `pnpm install --frozen-lockfile`):

| Job | Schedule (UTC) | Command |
|---|---|---|
| Monthly import | `0 14 1 * *` | `IMPORT_PUBLISH=1 pnpm --filter web import:btc` |
| Daily launch check | `0 15 * * *` | `IMPORT_PUBLISH=1 IMPORT_LIMIT=0 pnpm --filter web import:btc` |

Environment for both: `PRICE_RESOLVER`, `IMPORT_CURATOR_KEY`, `IMPORT_CREATOR_KEY` (secret env vars, never
`NEXT_PUBLIC_`), optionally `APP_URL` (default `https://www.mezonk.xyz`).

### Settings

| Variable | Default | Meaning |
|---|---|---|
| `IMPORT_LIMIT` | 3 | new markets per run (0 = only launch earlier imports) |
| `IMPORT_MAX_DAYS` | 45 | latest measurement time, days from now |
| `IMPORT_MIN_TRADE_HOURS` | 24 | trading time wanted after seeding ends |
| `IMPORT_MIN_PROB` / `IMPORT_MAX_PROB` | 0.1 / 0.9 | skip one-sided questions |
| `IMPORT_PER_MOMENT` | 2 | markets sharing one measurement time |
| `IMPORT_SOURCES` | `polymarket,kalshi` | |
| `IMPORT_KALSHI_SERIES` | `KXBTCD,KXBTC,KXBTCMAXY,KXBTCMINY` | series scanned (non-qualifying ones are skipped) |
| `IMPORT_SNAPSHOT` | | saved API responses `{ "polymarket": …, "kalshi": … }` to use instead of fetching |
| `IMPORT_PLAN_FILE` | `btc-import-plan.json` | |

## Trust and risks

- **The curator key on a host is an automated curator.** It approves only rules this script generates from a fixed
  template, but anyone holding the key could approve anything. Use a dedicated wallet that holds nothing else and can
  be revoked with `factory.setCurator(<wallet>, false)`; never the factory owner or a personal curator wallet.
- **Rules are on-chain and immutable.** A bad parse can't be edited after publication; resolve it Invalid through the
  normal process. Read the plan output before the first unattended run.
- **Source formats can change.** The parsers check every field and skip what they don't recognise, with a reason.
  If a run prints "0 open Bitcoin markets" or only skips, check the source's API before changing filters.
- **The seed orders are the creator's own money at risk.** They become normal resting orders at launch and can be
  filled.
- **The source price shown on the market page** (*Same question on Polymarket*) is read live from the source's public
  API with the time it was read, cached for two minutes. It is context only and never prices or settles anything.

## Verified

- Unit tests (14) cover both parsers, every skip rule, de-duplication, the rules text (it passes the app's own
  metadata schema and review checks) and seed prices.
- Local fork of Mezo testnet (2026-11-07): from a snapshot shaped like both APIs, a publish run suggested, approved,
  published, recorded the strike for and seeded 3 markets under policy #1; they stayed in seeding with one seeder. After
  a second wallet seeded one of them, the next run skipped all three questions as already listed and launched that
  market. The reference route and market page were checked in light and dark, desktop and mobile.
- **Not verified:** the live Polymarket and Kalshi responses. The development sandbox couldn't reach either API, so the
  parsers follow the APIs' documented formats. Run the plan once from a normal machine and read its output before
  publishing.
