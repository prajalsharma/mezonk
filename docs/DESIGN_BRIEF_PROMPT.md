# Prompt: MEZONK logo and UI theme

Paste everything inside the block below into a new Claude conversation.

```text
You are a senior brand and product designer. Design a new logo and a complete UI theme for MEZONK, then show it on
the key screens. Work in two passes: first propose 3 distinct directions with short rationale, then fully develop the
strongest one (pick it yourself and say why). Deliver real, usable assets, not mood descriptions.

## The product
MEZONK is a prediction market built on Mezo, a Bitcoin network. People trade Yes or No shares on questions with
strict, public rules ("Will BTC close above $150,000 on Coinbase on 31 Dec 2026 (UTC)?"). Every Yes+No pair is
backed by exactly 1 MUSD (Mezo's Bitcoin-backed dollar). A winning share pays 1 MUSD; Invalid pays 0.50.
Trading is an order book: people buy from other people's offers at a price between 1¢ and 99¢; the platform never
takes a side. New markets start in "Seeding": backers lock funded orders, and the market goes live only when there is
enough real liquidity on both sides; if not, everyone is refunded. After close, a resolver proposes the outcome with
evidence, anyone can challenge it, and an arbitrator rules.

Audience: crypto-native traders and Bitcoin holders on Mezo, plus curious newcomers. They want to scan markets fast,
read one clear price, trade in two taps, and trust that payouts are real. The tone is precise, calm and credible,
like a good exchange, not a casino and not a meme project.

## Name and brand constraints
- Name: MEZONK (all caps in the wordmark is fine). It is independent: "built on Mezo", never "by Mezo". Do not copy
  Mezo's logo, colours or marks.
- The old mark (a red/white split coin) is retired. Avoid coins, half-circles, generic checkmarks, crystal balls,
  rockets, and anything that reads as a toggle switch or moon icon at small sizes.
- Ideas worth exploring: two opposing outcomes resolving into one answer; a balance or fulcrum; an order book's two
  sides meeting at a price; a precise, engineered letterform. Pick one idea and make it simple.

## Logo deliverables
1. Primary lockup (mark + wordmark), horizontal, as clean SVG.
2. Mark alone, legible and distinctive at 16 px (favicon) and 32 px; provide a 16 px-optimised version if needed.
3. Monochrome versions (on white, on black) and the colour version.
4. App icon (rounded square) and a social/OG image layout (1200×630).
5. Clear-space and minimum-size rules in one short paragraph.
SVGs must be hand-clean (few paths, no embedded raster, no strokes that break when scaled).

## Colour: blue, black and white
Build the palette around a confident blue (your choice of hue; avoid the generic #3B82F6 Tailwind blue and avoid
navy-and-gold), near-black and white. Use OKLCH values and also give hex.
Provide light and dark themes as named tokens:
- bg, surface, surface-raised, border, border-strong, text, text-muted, text-subtle, focus ring;
- brand / primary (and its hover, pressed, subtle-background, on-primary text);
- YES and NO: they must be clearly distinct, must not rely on colour alone (always labelled), and must not use red or
  green (red/green are reserved for loss/gain). A good starting point: YES = the brand blue, NO = high-contrast
  neutral (white on dark, near-black on light). Explain your choice;
- bids and asks in the order book must map to the same YES/NO logic, not to a separate red/green scheme;
- gain, loss, warning, danger, info, success: semantic only, used sparingly, distinct from YES/NO;
- chart line and area colours.
Every text/background pair must meet WCAG AA (4.5:1 body, 3:1 large text and UI glyphs). List the contrast ratio for
each pair you define. Both themes must feel equally finished; the app follows the OS theme by default.

## Typography
One sans family for everything, plus one monospaced or tabular-figure family used only for numbers (prices,
amounts, addresses). No serif display face, no italic-accent headlines. Give a type scale (size/line-height/weight/
tracking) for: display, h1, h2, h3, body, small, label, number-large, number-small. Use free, web-safe fonts
(Google Fonts or similar) and name them exactly.

## System
- Spacing scale, one radius scale (at most 3 values), elevation (at most 2 shadows), border usage.
- Motion: durations and easing; respect reduced motion; no bounce.
- Iconography: one icon set, one stroke weight.
- Components to specify with states (default, hover, focus, active, disabled, loading, error): primary/secondary/
  ghost buttons, Buy Yes / Buy No buttons, segmented control, input with unit suffix, market card, market list row,
  probability bar, order-book row with depth bar, trade ticket, status chip (Seeding, Live, Low liquidity, Closed,
  Resolving, Resolved Yes/No/Invalid, Didn't launch), toast, empty state, skeleton, transaction progress.

## Screens to mock up (desktop 1440 px and phone 390 px, both themes for the first two)
1. Markets: search, tabs Live / Seeding / Resolving / Resolved, category filters, a featured market with real
   hierarchy (not a grid of identical cards), list/grid toggle.
2. Market page: question, status, one headline price as probability ("41% Yes"), chart (step line, moves only on
   trades), a simple trade ticket (Buy Yes / Buy No, amount in MUSD, estimated shares, payout if right, fee, one
   button) with an "Advanced" toggle for limit orders, a collapsible order book, rules, discussion, and resolution
   that only expands when the market is closed. On phone the ticket is a bottom sheet.
3. Seeding market: "Back this market" flow with a progress meter for the launch conditions (both sides funded,
   spread, number of backers, deadline), what gets locked, refund guarantee, fee-rebate terms. No promised yield.
4. Portfolio: positions with live value, open orders, refunds available, claimable payouts and rebates.
5. Create (suggest a market): a calm multi-step form for question, rules, source and timing.
Use realistic sample data (BTC price, Mezo TVL, US CPI questions). Prices in cents, amounts in MUSD.

## Rules for the UI
- Data honesty: a price is shown only from a real trade; a book midpoint is labelled "indicative"; with no trades,
  show "No trades yet", never an invented number. Never show Yes and No buy prices side by side without making the
  spread understandable.
- Avoid: serif headlines with one italic word, uppercase tracked eyebrow labels above every section, numbered section
  markers, pill badges everywhere, identical icon-card grids, glassmorphism, gradient text, glowing blobs, grid-paper
  backgrounds, scrolling tickers, side-stripe borders, hero-metric stat rows.
- Plain words: "Buy Yes", "You pay", "You get if Yes wins", "Refund", "Back this market". No jargon like "fill",
  "taker", "escrow", "graduate" in primary UI (fine in an Advanced or help tooltip).
- Accessible: visible focus, 44 px touch targets, labels on every control, state never conveyed by colour alone.

## Output format
1. The 3 directions (one paragraph + a tiny palette and mark sketch each), then your pick.
2. Logo SVG code for each deliverable.
3. Design tokens as CSS custom properties for light and dark (`:root` and `[data-theme="dark"]`), plus the same as
   JSON, plus a Tailwind v4 `@theme` block.
4. Type scale and component specs as a concise table.
5. The screens as self-contained HTML/Tailwind (or a single React artifact with a theme switcher), using only the
   tokens you defined.
6. A short "how to apply this to the existing Next.js app" checklist (what to replace, in what order).
```
