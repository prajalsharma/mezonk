# Design reference study (2026-10-20)

How each reference was inspected, honestly:

| Reference | Inspected how |
|---|---|
| mezo.org | Rendered with Playwright at 1440/820/390 and read as text |
| vezo.exchange | Rendered with Playwright at 1440/820/390 |
| polymarket.com, kalshi.com | Both block headless browsers (timeouts on load); not re-captured today. Notes below come from prior familiarity with their public UI and are marked as such |

## Mezo (ecosystem identity) — rendered

- Magenta-red brand colour (very close to MEZONK's `#FF004D`), off-white canvas, black buttons.
- Display type is an **italic high-contrast serif** ("*Bank on yourself.*"); supporting labels are **monospace caps**
  ("PERMISSIONLESS · BANK-FREE").
- Playful confident voice ("Ready to break the bank?") balanced by plain risk disclaimers.
- Lesson: our accent should stay the logo red (it is already Mezo-native), and an editorial italic serif for hero moments
  plus mono data labels ties MEZONK to the ecosystem without copying the site. We do **not** copy its cream canvas, hero
  imagery or layout.

## Vezo (existing sibling product) — rendered

- Same red, heavy grotesk headlines with a grey second line, a circular "discount gauge" as the hero object, price ticker
  strip under the nav, one-row listing table, numbered settlement steps, FAQ list.
- Lesson: a **real product object in the hero** (a live gauge) and a **live price ticker** make a page feel active without
  fabricated stats. Avoid: its cream-pink canvas and the sameness of stacked white sections.

## Polymarket (discovery) — prior knowledge

- Dense grid of cards: small square image, question, big percentage or per-outcome rows, Yes/No buttons priced in cents,
  volume in the footer. Category tabs across the top. Dark-first.
- Lesson: the card is the unit of discovery; price and outcome buttons sit on the card; volume and deadline are footer
  metadata. We adopt the anatomy, not the visuals, and price in MUSD (we do not use "¢", which implies USD cents).

## Kalshi (structured trading) — prior knowledge

- Very legible numbers, clear "Yes 44¢ / No 57¢" buttons, rules and settlement source surfaced on the market page, a
  calm trade ticket that previews cost and payout before confirmation.
- Lesson: precision and transparency in the ticket; rules discoverable next to the price, not buried.

## Principles taken

1. Cards for discovery, tables for scanning (toggle), tiles for the market page.
2. One accent (logo red = YES), mint only for system gains/success, amber for losses/warnings. Red never means loss.
3. Hero shows a real market object (live chart + outcome tiles) and a real ticker; no invented numbers.
4. Editorial italic serif only for hero/section moments; Geist for UI; Geist Mono for every number and data label.
5. Rules, fees and "you can lose the full amount" stay visible at the point of decision.
