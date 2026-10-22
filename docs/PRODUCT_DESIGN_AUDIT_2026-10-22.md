# MEZONK product and design audit (2026-10-22)

Method: every main screen captured on the local fork at 1440 px and 390 px, in dark and light, with console errors,
overflow, font families, radii and page height measured; then the code paths behind what looked wrong were read.
No console errors or horizontal overflow were found. Everything below is a product or design problem, not a crash.

Verdict: the protocol underneath is solid (order book, seeding, refunds, honest prices). The interface around it is
an editorial landing-page style bolted onto a trading product. It explains itself too often, repeats the same card
grid everywhere, mixes three price units, exposes developer vocabulary, and buries the trade. Rebuild the UI around
one job: **find a market, understand the price, trade or back it, get paid.**

## 1. Product and information architecture

| # | Finding | Evidence | Severity |
|---|---|---|---|
| P1 | Too many destinations for a young product: Discover, Markets, Activity, Suggest, Proposals, Curate, Resolve, Portfolio, Docs, Status, Settings, Admin. Discover, Markets and the home board are three browsing surfaces over the same list. | Header has 6 nav items + search + network + theme + sign-in + balance + wallet. | High |
| P2 | The same markets repeat across Discover's sections (Trending, Closing soon, New, Thin liquidity show the same cards); "Deepest liquidity" shows one card in a 3-column row. | `d-discover.png` | High |
| P3 | The product is explained three times on the home page (5-step lifecycle, worked example, "Have a question" with another numbered list) and again on Discover. | Home is 4,275 px desktop / 8,824 px phone. | High |
| P4 | The trade isn't the hero of the market page. The ticket is top-right, the order book is a separate panel below the fold, and a full resolution panel (roles, windows, bonds) sits in the middle of a live market. | Market page 4,904 px desktop / 7,189 px phone. | High |
| P5 | Three price languages at once: cards say "55%", tiles say "40¢ / 66¢", movement says "0 pts". Yes 40¢ + No 66¢ = 106 confuses anyone who doesn't know what a spread is. | `d-live.png`, cards | High |
| P6 | The default ticket is a pro ticket: shares instead of money, "Worst" price, signed vs escrowed remainder, all-or-nothing. A casual user wants "Spend 20 MUSD on Yes at about 41¢". | TradeTicket | High |
| P7 | Developer vocabulary leaks into the UI: activity rows read "TakeSettled", "RebateAccrued", "Fill", "OrderPlaced", "MarketApprovalUsed". | Market activity list | High |
| P8 | Onboarding is four gates before the first trade (connect, sign a message, approve MUSD, have MUSD at all). On testnet, MUSD needs a ≥1,800 borrow on Mezo. The UI mentions this only as small print. | Ticket footer | High |
| P9 | Outdated copy contradicts the order-book model: Suggest says "an approved creator seeds it and it goes live" and "publishes it with seed liquidity"; the home CTA list says "A creator seeds and publishes". | `d-suggest.png`, home | Medium |
| P10 | Featured market selection doesn't require liquidity, so the hero can show a market whose Yes button reads "no offers". | `l-home.png` | Medium |
| P11 | Resolution center prints raw minutes ("7941 minutes left") and lists everything as one long undifferentiated column without actions. | `d-resolve.png`, `formatDuration` | Medium |
| P12 | Seeding is the most novel part of the product but has no destination of its own; it is a status chip and a sidebar panel. "Back a market" should be a first-class action. | Markets filters | Medium |
| P13 | The system theme is ignored: `defaultTheme="dark"` with `enableSystem`, so light-mode users always get dark until they toggle. | `providers.tsx` | Low |

## 2. Visual design

| # | Finding | Evidence | Severity |
|---|---|---|---|
| D1 | The "serif headline with one italic accent word" formula is used on almost every section ("Call it *before*", "What the market *thinks*", "From hunch *to payout*", "Check it *yourself*", "worth a *market?*"). It reads as template, not brand. | home | High |
| D2 | Identical card grids everywhere: market cards, five "Check it yourself" icon cards, Discover sections. Nothing has hierarchy; every market looks equally important. | home, discover | High |
| D3 | Four typefaces: Instrument Serif (display), Geist (UI), Geist Mono (labels, numbers, footers), Hanken Grotesk (wordmark only). Mono is overused for small uppercase labels ("FEATURED MARKET", "VOLUME", "CHANCE OF YES"), which act as eyebrows. | measured | High |
| D4 | Red is YES. In trading, red means sell or loss, and the book colours asks red and bids green, so a red "Yes" tile sits next to red asks that mean the opposite. YES/NO, bid/ask and gain/loss use three overlapping colour systems. | book + tiles | High |
| D5 | Six corner radii (4, 8, 12, 18, 24 px and full pills) and three surface depths, applied inconsistently. Panels inside panels on the market page. | measured | Medium |
| D6 | Decorative noise: grid-pattern backgrounds behind heroes and empty states, glows, a scrolling ticker of the same few markets, a pill eyebrow above the hero. | home, empty states | Medium |
| D7 | Empty and sparse states waste space: a 380 px empty image dropzone on Suggest step 1; a full-height chart for two trades; a Portfolio empty state whose Connect button is clipped by a fade mask. | `d-suggest.png`, `d-portfolio.png` | Medium |
| D8 | The 5-column "lifecycle" step row wraps its sixth step onto a lonely second line. | home | Low |
| D9 | The logo (split coin, red/white) is a generic "half circle" shape that also resembles a toggle and a moon icon; at 16 px it loses the split. The wordmark uses a typeface found nowhere else. | header, favicon | Medium |
| D10 | Header duplicates network state ("Local fork" dot + a full-width banner under it). On a real network these should be one quiet indicator. | all pages | Low |

## 3. What to keep

- Honest data rules: only a fill is a price, the mid is labelled indicative, no trade means no number.
- Plain, specific copy in transaction states ("Confirmed on-chain", "No funds moved").
- Explicit stages (Seeding, Live, Low liquidity, Didn't launch, Resolving, Resolved) and refunds that work without the site.
- Accessibility basics already in place: labelled controls, keyboard-reachable actions, aria-live transaction status.

## 4. Direction for the rebuild

1. **Three primary destinations**: Markets (browse + search, with Live / Seeding / Resolving tabs), Portfolio, Create.
   Move Activity, Resolution center, Status and Docs to secondary navigation; Curate and Admin appear only for those roles.
2. **One price language**: show probability as the headline ("41% Yes"), and the action price in the button
   ("Buy Yes · 41¢"). Never show Yes and No buy prices side by side without the spread explained.
3. **Simple ticket by default**: amount in MUSD, outcome, estimated shares and payout, one button. "Advanced" reveals
   limit price, remainder handling and all-or-nothing.
4. **Market page order**: question and status → price and chart → ticket (sticky on desktop, bottom sheet on phone)
   → book (collapsed by default) → rules → discussion → resolution (expanded only when it matters) → on-chain details.
5. **Seeding as its own flow**: "Back this market" explains the lock, refund and rebate in three short lines, shows a
   progress meter of the on-chain launch conditions, and celebrates the launch.
6. **Human activity**: "Ada bought 30 Yes at 41¢", "Market launched", "Outcome proposed: Yes", never event names.
7. **Visual system**: blue / black / white, one sans family plus one mono for numbers only, one radius scale, no
   serif-italic headline formula, no grid backgrounds, no ticker, no identical card grids; respect the OS theme.

The design brief and prompt for the new logo and UI theme are in `docs/DESIGN_BRIEF_PROMPT.md`.
