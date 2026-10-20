# MEZONK frontend audit

Date: 20 Oct 2026. Build: production `next start` on http://localhost:3000 against the local Mezo Testnet fork.
Method: full-page screenshots of every route, light and dark at 1280px, plus `/`, `/discover`, `/markets`, `/markets/1` and `/create` at 390px. Screenshot names below (for example `m1-dark-1280`) refer to that set. I also read `src/components/**`, `src/features/**`, `src/app/**` and `globals.css`.

## Overall impression

The foundations are sound. Tokens cover both themes, status uses dot + word, numerals are tabular in most places, copy is plain, and there are no glow blobs, LIVE pills or VERIFIED badges. Lists are rows, not card grids. The problem is the owner's: it looks like a well-made document, not a market. Every route has the same shape: a 36px title, a grey sentence, then rows of 13–15px text on cream. Nothing is big except the page titles. The home page spends most of its height on explainer prose (how it works, worked example, what you can check) and shows only two markets. Prices never move on screen, rows have no hover depth, and the theme switch snaps. The market page reads like a contract explorer with a trade form attached: the trade panel is small, the chart is a flat line, and once a market resolves the page still leads with "65% chance of Yes".

There are also real bugs. On mobile the logo renders twice, `aria-labelledby` references are broken on Discover, the trade form is mounted twice (so its IDs are duplicated), and relative times say "in 26 days" for past events. The current outcome colours (YES green, NO red) are the reverse of the new logo's rule (red half = YES, ink half = NO). Fixing that touches tokens, the probability bar, the trade panel, rules, deltas, status dots and the error colour.

**Note on repo rules.** `CLAUDE.md` currently says red is used for "marker, NO, destructive" and that the app has "no … glass". The new brand rule (red = YES) and the owner's brief (glass only on floating elements) contradict both lines. Update `CLAUDE.md` before implementing F01/F02/F22/F24, or agents will undo the changes.

---

## Findings

Priority: **P0** = bug or brand conflict that blocks the redesign, **P1** = large effect on how polished the product feels, **P2** = refinement.

### Brand and outcome colour

**F01 — YES/NO colours are inverted against the new logo** · P0
- *Where:* every route with odds. `m1-light-1280`: the bar fill and the "Yes 44%" label are green (`--yes #0a6a40`), the track and "No 56%" are red/pink (`--no #c8003c`). The trade panel's Yes card is green and its No card red. In Resolution rules, "Resolves Yes if" is green and "Resolves No if" red. Profit-if-wins is green.
- *Fix:* remap the semantic tokens to the brand rule: `--yes` = red (`#FF004D` for fills, `--accent-text`-strength `#C8003C`/`#FF4D7C` for text), `--no` = ink (`#14110F` light / `#F2EFE9` dark), plus `--yes-soft`/`--no-soft` derived from those. Drop green from outcome UI entirely.
- *Files:* `src/app/globals.css`, `components/markets/Probability.tsx`, `components/trading/TradePanel.tsx`, `components/markets/RulesPanel.tsx`, `app/markets/[id]/MarketView.tsx` (PositionCard), `features/create/CreateWizard.tsx` (stepper "done" uses `bg-yes`).
- *Acceptance:* `grep -rn "text-yes\|bg-yes\|border-yes" src` returns only outcome-YES uses, and in both themes every YES element renders red and every NO element renders ink. No green remains in outcome UI.

**F02 — Red means "error" and "danger" as well as an outcome** · P0
- *Where:* `--no` drives error notices, field errors, `Button variant="danger"` (wrong-network button), toast error borders and down-deltas. Once F01 makes red mean YES, a red error reads as "YES".
- *Fix:* add dedicated `--danger`/`--danger-soft` (a darker brick or plain ink with an icon) and `--positive` tokens for system states. Point `Notice tone="error"`, `Field` errors, `TxStatus` failed, the toast error state and `variant="danger"` at `--danger`.
- *Files:* `globals.css`, `components/ui/primitives.tsx`, `components/ui/Button.tsx`, `components/ui/Toast.tsx`, `components/trading/TxStatus.tsx`, `components/wallet/WalletButton.tsx`.
- *Acceptance:* no system-state component references `--no`/`--yes`; outcome and status colours are separate token families.

**F03 — The probability marker is the old logo's red dot** · P1
- *Where:* `ProbabilityBar` draws a red dot (`bg-accent`, "the logo's red dot") at the YES/NO boundary on every row and on the hero bar (`markets-light-1280`). The new mark is a split coin, so the dot no longer means anything, and it adds red noise to all 25 rows.
- *Fix:* redraw the bar as the split coin: a red YES segment and an ink NO segment with a 2px "spread" gap between them, the YES segment offset 1px down and the NO segment 1px up on the `lg` size. No dot.
- *Files:* `components/markets/Probability.tsx`.
- *Acceptance:* the bar has two coloured segments and a visible gap, no circle element, and the same rendering in both themes.

**F04 — The logo is still the old M + dot mark** · P1
- *Where:* the header, footer and home CTA all use `LogoMark` (an M stroke with a red dot). `public/mezonk-icon.svg`, `mezonk-mark-*.svg` and `app/icon.svg` are the same.
- *Fix:* replace `LogoMark` with the split-coin SVG, keeping the theme-token approach (`--logo-yes`, `--logo-no`, `--logo-cut`). Keep the Hanken 600 / +7% caps wordmark. Regenerate the favicon, `icon.svg` and the RainbowKit app icon.
- *Files:* `components/brand/Logo.tsx`, `public/*.svg`, `app/icon.svg`.
- *Acceptance:* one logo component; the favicon and header mark match; the red half is on the left in both themes.

**F05 — Resolved Yes and Resolved No look the same** · P1
- *Where:* `markets-light-1280`: "Resolved Yes" and "Resolved No" both get a red dot, because `StageStatus` maps `resolved → accent`. `m5-dark-1280` shows the same.
- *Fix:* tone the dot by final outcome (YES = red half, NO = ink half, Invalid = muted with a hollow ring). Better: show a small half-coin glyph.
- *Files:* `components/markets/StageStatus.tsx`, `components/ui/primitives.tsx` (`Status`).
- *Acceptance:* in a list containing both, Resolved Yes and Resolved No rows are distinguishable at a glance without reading the word.

### Home and discover: first impression

**F06 — Home is an explainer, not a market** · P1
- *Where:* `home-light-1280`: of about 2,000px, only one 270px box shows markets (two of them). The rest is "How a market works" (a 2×2 grid of number + heading + paragraph), "A worked example", "What you can check yourself" (another 2×2 grid) and a dark CTA slab. The left column of each section is a heading with 200px of empty space below it.
- *Fix:* lead with the market. Make the hero a compact statement plus a live board: the top 6–8 open markets as dense rows with big probability numerals and 24h change, then category tabs. Move the explainer to a single "How it works" strip with one line per step, linking to `/docs`. Delete the duplicated trust grid (it repeats docs and footer content).
- *Files:* `app/page.tsx`, `app/FeaturedMarkets.tsx`.
- *Acceptance:* at 1280×900 above the fold, at least 5 tradeable markets are visible with probabilities, and the page height is under 1.6× the viewport.

**F07 — The "How a market works" content is repeated three times** · P2
- *Where:* the home 4-step grid, the `/discover` sidebar ordered list and the `/docs` "How a market works" list are the same content (`home-light-1280`, `discover-light-1280`, `docs-light-1280`).
- *Fix:* keep it in `/docs` only. On Discover, replace it with a one-line "New here? How markets work →" link.
- *Files:* `app/page.tsx`, `app/discover/DiscoverSections.tsx`.
- *Acceptance:* the step copy exists in one source file.

**F08 — The dark CTA slab is a generic template block** · P2
- *Where:* the bottom of `home-light-1280`: a full-width rounded-lg slab with the icon, "Have a question worth a market?", a subline and a button. In dark mode it inverts to a cream slab (`home-dark-1280`), the brightest object on the page.
- *Fix:* drop it, or make it an inline row inside the market board ("Don't see it? Create a market"). Don't invert surfaces in dark mode.
- *Files:* `app/page.tsx`.
- *Acceptance:* no full-bleed rounded CTA slab on home, and no element in dark mode with a background lighter than `--surface-2` except primary buttons.

**F09 — Discover repeats the same markets in different sections** · P1
- *Where:* `discover-light-1280`: the MUSD $0.995 market appears under Closing soon, New and Deepest liquidity. The BTC $150k market appears twice. Trending and Thin liquidity show only grey empty text. The page looks sparse and repetitive.
- *Fix:* de-duplicate across sections (a market appears in its highest-ranked section only), collapse empty sections into one muted line at the bottom, and add a category strip at the top as horizontal tabs rather than the sidebar chips.
- *Files:* `app/discover/DiscoverSections.tsx`.
- *Acceptance:* no market ID renders twice on `/discover`, and empty sections render no heading.

**F10 — Test data dominates the index** · P1 (data, but it decides the first impression)
- *Where:* `markets-light-1280`: 22 of the first 25 rows are "E2E …: will the test outcome be Yes on 1 Jan 2030?", repeated, all at 48%.
- *Fix:* seed the fork with about 12 realistic markets across categories, and hide markets whose metadata is flagged `test` (or whose question starts with `E2E`) unless `?debug=1` is set.
- *Files:* `scripts/seed-local.ts`, `app/api/markets/route.ts` or `src/server/queries.ts`.
- *Acceptance:* the default `/markets` view on the local fork shows no "E2E" questions.

### Market list and rows

**F11 — Rows carry redundant labels and noise** · P1
- *Where:* `markets-light-1280`: every row repeats "volume" and "collateral" under the numbers even though the column header says "Volume (MUSD)" / "Collateral (MUSD)". Every row shows "0 pts" in grey. All 25 rows render a bar with the same red dot.
- *Fix:* remove the per-row sub-labels on md+ (keep them only below md, where there is no header). Hide the 24h delta when it is |Δ| < 1pt, or render "–". Make the probability numeral the visual anchor (text-xl, weight 600) and keep a thin 4px bar.
- *Files:* `components/markets/MarketRow.tsx`, `components/markets/Probability.tsx` (`Change`).
- *Acceptance:* on md+, no row contains the words "volume" or "collateral", and no row shows "0 pts".

**F12 — Rows have no hover, focus or press depth** · P1
- *Where:* `MarketRow` hover only underlines the question. The full-row link (`after:inset-0`) has no visible focus ring on the row.
- *Fix:* on hover/focus-visible, tint the row background to `--surface` with a 120ms transition and show a 1px inset left bar in the YES colour. Add `:active` scale(0.995). Put a `focus-visible` ring on the row container (`has-[:focus-visible]`).
- *Files:* `components/markets/MarketRow.tsx`.
- *Acceptance:* keyboard-tabbing through `/markets` shows a visible ring around each whole row, and hover produces a background change.

**F13 — The filter bar mixes native selects with custom chips** · P1
- *Where:* `markets-vp-dark` and `markets-vp-390`: "Sort: Newest" and "Any collateral" are OS `<select>`s with system chevrons (they look different in dark mode). Status uses filled ink tabs and category uses outlined chips, two chip styles in one bar. On 390px the category chips overflow with no scroll affordance.
- *Fix:* build one `Select`/`Menu` primitive (a popover with tasteful glass, per the brief) and one `Chip` primitive with a single selected style. Put status and category in one scroll row with a fade mask at the edge on mobile. Make the column headers ("Chance of Yes", "Volume", "Collateral") clickable sort toggles with ▲▼.
- *Files:* `app/markets/MarketsBrowser.tsx`, new `components/ui/Select.tsx`, `components/ui/Chip.tsx`.
- *Acceptance:* no `<select>` in the markets browser; clicking the Volume header sorts by volume; at 390px the chip row shows an edge fade.

**F14 — The list has no live feeling** · P1
- *Where:* rows refetch on an interval, but probabilities snap in place and new markets pop in. No list stagger.
- *Fix:* see F29 (motion). In this list specifically, flash the probability numeral (a 600ms background tint in the direction of change) and roll its digits when it changes.
- *Files:* `components/markets/MarketRow.tsx`, new `components/ui/AnimatedNumber.tsx`.
- *Acceptance:* changing a market price on the fork updates its row with a visible transition of 300–600ms, and none under reduced motion.

### Market detail and trading panel

**F15 — The trade panel is underpowered for a trading product** · P1
- *Where:* `m1-vp`: the panel is 22rem wide. The Yes/No selectors are small text cards ("Yes 0.444 MUSD"). Slippage occupies a permanent row. There are no quick amounts. The panel and its CTA sit at the same visual weight as the page body.
- *Fix:* make Buy Yes / Buy No two large outcome buttons, each showing the price in cents as a big numeral (for example "Yes 44¢", "No 56¢") in the brand split colours. Add quick-amount chips (+10, +50, +100, Max) under the input. Move slippage into a gear popover. Show "To win X MUSD" as the single highlighted output line, with the detailed `KeyValue` list collapsed behind "Details".
- *Files:* `components/trading/TradePanel.tsx`.
- *Acceptance:* a connected user can place a 50 MUSD Yes trade in at most 3 clicks (side → +50 → Buy), and the payout figure is the largest number in the panel after the amount.

**F16 — The trade panel is mounted twice** · P0
- *Where:* `MarketView.tsx` renders `<TradePanel>` and `<PositionCard>` once in a `lg:hidden` block and again in a `hidden lg:block` aside. Both instances mount. That means duplicate `id="trade-amount"` (so the `<label for>` binds to the wrong input on one breakpoint), duplicated radiogroups, two 1-second `setInterval` re-render loops and duplicated wagmi reads.
- *Fix:* render the panel once and move it with CSS grid placement (`order`/grid areas), or use a `useMediaQuery` gate.
- *Files:* `app/markets/[id]/MarketView.tsx`, `components/trading/TradePanel.tsx`.
- *Acceptance:* `document.querySelectorAll('#trade-amount').length === 1` at any width.

**F17 — Resolved and closed markets still headline a live probability** · P1
- *Where:* `m5-dark-1280` (Resolved Yes): the hero is "65% chance of Yes" with a bar, and the right column holds only a 2-line grey box, "Trading has closed…". `m4-light-1280` (Disputed) is the same.
- *Fix:* once a market has finalized, replace the hero with the outcome: "Resolved **Yes**" in the YES colour with the split-coin glyph, the final date and "Each Yes share pays 1 MUSD". Show the last traded price as secondary text. While disputed, show "Disputed · awaiting arbitration until 26 Oct". Have the right column show the user's claim card or the next action (propose, challenge, finalize) instead of the dead box.
- *Files:* `app/markets/[id]/MarketView.tsx`, `components/trading/TradePanel.tsx` (closed branch), `features/resolution/ResolutionPanel.tsx`, `features/resolution/Claims.tsx`.
- *Acceptance:* on `/markets/5` the first heading-level number shown is the outcome, not a percentage, and the right column contains an actionable element or the position summary.

**F18 — The chart is flat, clipped and unbranded** · P1
- *Where:* `m1-vp`: the "100%" tick is clipped to "l00%" at the left edge (`margin.left: -12` with `width: 44`). With 4 trades the line is perfectly flat, because same-timestamp trades on the fork collapse to one point. The line is ink and the end dot red, with no area fill. At 224px tall it reads as an empty frame.
- *Fix:* set the left margin to 0 (or a Y-axis width of 40 with no negative margin). Fill the area under the step line with a 6% YES tint. Draw a 50% reference line. Make the hover crosshair show price + time. When there are fewer than 2 distinct timestamps, show an inline "Not enough trades for a chart yet" state at 120px instead of a 224px flat line.
- *Files:* `components/markets/PriceChart.tsx`.
- *Acceptance:* every Y tick label is fully visible at 1280 and 390, and a market with fewer than 2 distinct price points shows the short empty state.

**F19 — The detail page reads like an explorer dump** · P2
- *Where:* `m4-light-1280` is 3,800px tall. It contains Resolution rules, a Resolution status card (which repeats the question text), a "Resolution starts after trading closes" box, a "Roles, windows and bonds" `<details>` with a raw ▼ triangle, the evidence trail, activity, and an "On-chain details" table. Everything has equal weight.
- *Fix:* use tabs below the chart: **Rules** | **Resolution** | **Activity** | **Contract**, with Rules open by default. Remove the repeated question inside the resolution card. Replace the native `<summary>` marker with a chevron icon from the icon set.
- *Files:* `app/markets/[id]/MarketView.tsx`, `features/resolution/ResolutionPanel.tsx`, `features/resolution/Timeline.tsx`.
- *Acceptance:* the market page at 1280 is under 2,000px tall by default, with each section reachable by a tab or anchor.

**F20 — Stat row numbers lack units and are inconsistent** · P2
- *Where:* `m1-vp`: "Volume 226.18" and "Collateral 1,201.67" have no unit. `m5-dark-1280`: "Pool (Yes / No shares) 150.4 / 277.04". `formatShares` uses 0–2 decimals, so columns don't align.
- *Fix:* append a muted "MUSD" suffix to money stats, and use fixed 2 decimals for shares in tables (`nf(2,2)`).
- *Files:* `app/markets/[id]/MarketView.tsx`, `lib/format/index.ts`.
- *Acceptance:* every money figure on the detail page carries a unit, and share counts in a column all have the same number of decimals.

### Navigation, header and mobile nav

**F21 — The logo renders twice on mobile** · P0
- *Where:* `home-vp-390`, `m1-vp-390` and `markets-vp-390`: the "M MEZONK" lockup and a second bare "M" stack, which pushes the header to 2 lines. Cause: `Lockup` hard-codes `inline-flex` in its own class string, and that beats the `hidden` passed in from `Header` (`className="hidden sm:inline-flex"`).
- *Fix:* make `Lockup` accept display classes without its own `inline-flex` (move `inline-flex` into a wrapper, or use `cx` with a `twMerge`), or render a single element that hides the wordmark below `sm`.
- *Files:* `components/brand/Logo.tsx`, `components/layout/Header.tsx`.
- *Acceptance:* at 390px the header is 56px tall with exactly one logo mark.

**F22 — No search on mobile, and no command palette** · P1
- *Where:* below `md`, `SearchBox` is hidden and there is no search icon (`home-vp-390`). On desktop, "/" only focuses a field that submits to `/markets?q=` with no instant results.
- *Fix:* build a ⌘K / "/" command palette (glass surface, per the brief) with instant market results showing probability, recent markets (`useRecentlyViewed` already exists) and route jumps. On mobile, put a search icon button in the header that opens the same palette as a full-height sheet.
- *Files:* `components/layout/SearchBox.tsx` → new `components/layout/CommandPalette.tsx`, `components/layout/Header.tsx`.
- *Acceptance:* pressing ⌘K or "/" on any route opens the palette; typing "btc" lists matching markets within 300ms; it is reachable at 390px.

**F23 — The network badge and the fork banner say the same thing twice** · P2
- *Where:* every route: "● Local fork" in the header plus a full-width yellow banner directly beneath it ("Local development fork of Mezo Testnet…"). Combined, they cost about 90px of chrome on mobile (`home-vp-390`).
- *Fix:* keep the header badge, make it open a popover with the banner text, and show the banner once per session (dismissible) on the fork only.
- *Files:* `components/layout/DeploymentBanner.tsx`, `components/layout/NetworkStatus.tsx`.
- *Acceptance:* after dismissal the banner stays hidden for the session, and the header badge still exposes the full text.

**F24 — Mobile bottom nav: tiny labels, Docs missing, no glass** · P2
- *Where:* `MobileNav` labels are `text-[11px]`. Docs is excluded. The active state is a 4px dot.
- *Fix:* use 12px labels (`text-xs`) and an active state with an ink icon plus a 2px top indicator. Make the bar a floating translucent surface (this is a legitimate glass location) with safe-area padding. Put Docs in an overflow, or swap Activity into the palette.
- *Files:* `components/layout/Header.tsx`.
- *Acceptance:* label text is at least 12px and every tap target is at least 44×44px.

### Typography and numerals

**F25 — The type scale is too flat and too small** · P1
- *Where:* body is 15px (`--text-base`) and secondary text 13px/12px in `--muted`. Section heads are 22px. Only page titles and the 52px probability break out. Labels like "Volume", "Collateral" and "Traders" are 12px muted (`m1-vp`). The result is the "HTML-like" feel.
- *Fix:* a display tier for numerals (`--text-num-xl` 64px/600 tnum for the hero probability, 28px for row probabilities on discover) and 16px body. Keep 12px for metadata only. Add a tighter-tracked display style for H1s (−0.025em). Raise row questions to 16px/600.
- *Files:* `globals.css` (`@theme` type scale), `components/markets/MarketRow.tsx`, `app/markets/[id]/MarketView.tsx`.
- *Acceptance:* the scale has at least 3 steps above 28px, and no paragraph body text renders below 15px.

**F26 — Raw size values bypass the scale** · P2
- *Where:* `text-[3.5rem]` and `leading-[1.05]` (`app/page.tsx`), `text-[11px]` (Header, SearchBox, Timeline), `text-[10px]` (`Hint`), `text-[0.8125rem]` (Address, which duplicates `text-sm`), `text-[1.05rem]` (Logo).
- *Fix:* add `--text-2xs` (11px) and a display token to `@theme`, and replace the arbitrary values with them.
- *Files:* the files listed above.
- *Acceptance:* `grep -rn "text-\[" src` returns 0 results.

**F27 — Tabular numerals are not applied everywhere** · P2
- *Where:* `.tnum` is opt-in per element. The `/status` block numbers ("16248015 · 16248015") lack both tnum and thousands separators (`status-light-1280`). Activity amounts inside sentences are proportional. Footer addresses are fine (mono).
- *Fix:* apply `font-variant-numeric: tabular-nums` globally on `body` (Hanken supports it) and remove `.tnum`. Format block numbers with `Intl.NumberFormat`.
- *Files:* `globals.css`, `app/status/StatusView.tsx`.
- *Acceptance:* the `/status` block heights render as "16,248,015", and digits align vertically in every column.

### Spacing and rhythm

**F28 — Section rhythm is loose, and short pages float the footer** · P2
- *Where:* home sections are separated by 100–150px with a heading-only left column (`home-light-1280`). On `/portfolio` (`portfolio-dark-1280`) and `/status` the footer sits mid-viewport with a blank band beneath it.
- *Fix:* use one section spacing token (`--space-section: 64px` desktop, 40px mobile). Make `body` a flex column with `main { flex: 1 }`.
- *Files:* `app/layout.tsx`, `app/page.tsx`, `globals.css`.
- *Acceptance:* on `/portfolio` at 1280×900 the footer touches the viewport bottom, and home sections share a single spacing value.

### Motion

**F29 — There is almost no motion system** · P1
- *Where:* the only motion is `active:translate-y-px` on `Button`, a skeleton opacity pulse and `transition-colors`. `ThemeProvider` has `disableTransitionOnChange`. Toasts appear without transition. Recharts animation is off. There is no list stagger and no animated numbers.
- *Fix:* add a small motion layer (CSS + `@starting-style`, or `motion` at about 15kB if needed):
  - 30ms-stagger fade/translate-4px entrance on list rows;
  - hover elevation on rows and cards (background + 1px translate);
  - press scale(0.98) on all buttons, chips and segmented options;
  - a rolling-digit `AnimatedNumber` for probabilities and balances;
  - toast slide-in/out;
  - a 200ms theme cross-fade via the View Transitions API (`document.startViewTransition`).

  Keep the existing reduced-motion block.
- *Files:* `globals.css`, `components/ui/Toast.tsx`, `components/ui/primitives.tsx`, `components/layout/ThemeToggle.tsx`, `app/providers.tsx`, new `components/ui/AnimatedNumber.tsx`.
- *Acceptance:* with `prefers-reduced-motion: no-preference` each listed interaction animates within 120–400ms; with `reduce` none do, and nothing is lost functionally.

**F30 — Skeletons don't match content** · P2
- *Where:* the `TradePanel` loading state is an empty 320px box. The chart and activity loaders are single blocks. `FeaturedMarkets` uses 3 grey bars.
- *Fix:* build shape-accurate skeletons: a trade panel with segmented + two outcome buttons + input; activity as 5 row lines.
- *Files:* `components/trading/TradePanel.tsx`, `app/markets/[id]/MarketView.tsx`, `app/FeaturedMarkets.tsx`.
- *Acceptance:* layout shift (CLS) on `/markets/1` from skeleton to content is under 0.02.

### Forms (create wizard)

**F31 — Wizard progress is unclear on mobile, and the form uses native controls** · P1
- *Where:* `create-light-390`: the stepper scrolls sideways, so steps 4–5 are hidden and there is no "Step 1 of 5". The Category and Resolver fields are native `<select>`s. The initial probability is a raw `<input type=range>` with `accent-color`. A disabled "Back" shows on step 1. The example placeholder ("Will BTC close above $150,000…") reads like a filled value.
- *Fix:* on mobile, show a "Step 1 of 5 · Question" header with a 5-segment progress bar. Use the shared `Select` (F13). Make the probability slider a custom split-coin slider showing YES/NO prices live. Hide Back on step 1. Prefix the placeholder with "e.g." and lighten it.
- *Files:* `features/create/CreateWizard.tsx`.
- *Acceptance:* at 390px the current step number and total are visible without scrolling, and there is no `<select>` in the wizard.

**F32 — Inline validation is a muted line** · P2
- *Where:* field hints such as "0/160. A yes/no question with a date, ending in "?"" are small and muted. The quality issues only appear at the Review step.
- *Fix:* run validation live once a field is blurred. Turn the counter `--danger` near the limit. Show checklist ticks ("Has a date ✓", "Ends in ? ✓") under the question using icons, not emoji.
- *Files:* `features/create/CreateWizard.tsx`, `components/ui/primitives.tsx` (`Field`).
- *Acceptance:* typing a question without "?" shows the unmet check before Continue is pressed.

### Buttons and affordances

**F33 — Tooltip "?" triggers are 16px circles** · P1
- *Where:* `Hint` renders `size-4` buttons with 10px text: Discover headings, Slippage, Average price. Below the WCAG 2.5.8 24px minimum target, and it looks unfinished.
- *Fix:* use an `Info` icon from lucide at 14px inside a 24px hit area, and open the tooltip as a popover (glass allowed) with an arrow.
- *Files:* `components/ui/primitives.tsx`.
- *Acceptance:* every Hint trigger has a hit area of at least 24×24px.

**F34 — Icon usage is inconsistent** · P2
- *Where:* lucide icons in the nav and share, Unicode ▲▼ in `Change`, a native ▼ in `<summary>`, a "?" glyph in `Hint`, a blue `Info` icon (`--info #24518a`, off-palette) in the create notice (`create-light-1280`).
- *Fix:* use lucide only (ChevronDown, TrendingUp/Down or ArrowUp/Down, Info) at a fixed stroke of 1.75. Re-tint `--info` to ink-2, so the palette is cream/ink/red only.
- *Files:* `components/markets/Probability.tsx`, `features/resolution/ResolutionPanel.tsx`, `components/ui/primitives.tsx`, `globals.css`.
- *Acceptance:* there are no Unicode arrow or triangle characters in JSX, and `--info` is a neutral token.

### Empty, loading and error states

**F35 — Error states have no retry, and future timestamps leak** · P1
- *Where:* the `MarketList` error notice has no retry action. `ActivityList` computes relative time against `Date.now()`, while fork block times run ahead, so `/activity` shows "in 26 days" on every row (`activity-light-1280`) and `/markets/5` shows "in 19 hours" (`m5-dark-1280`). `MarketView` already uses chain time; `ActivityList` doesn't.
- *Fix:* add `action={<Button onClick={refetch}>Try again</Button>}` to list and chart errors. Pass the chain `now` into `ActivityList`, or clamp future values to "just now" in `relativeTime`.
- *Files:* `components/markets/MarketList.tsx`, `components/markets/ActivityList.tsx`, `lib/format/index.ts`, `components/markets/PriceChart.tsx`.
- *Acceptance:* no "in N …" strings appear for past events on `/activity`, and every network error state has a working retry button.

**F36 — Empty states are dashed boxes** · P2
- *Where:* `/portfolio` disconnected (`portfolio-dark-1280`) is a 1,230px-wide dashed rounded rectangle with centered text, the "giant rounded rectangle" the owner dislikes.
- *Fix:* use a left-aligned, compact empty state (headline, one line, action) with no border. On Portfolio, preview what will appear (column headers of an empty positions table) to set expectations.
- *Files:* `components/ui/primitives.tsx` (`EmptyState`), `features/portfolio/Portfolio.tsx`.
- *Acceptance:* `EmptyState` has no dashed border and a max width of 32rem.

**F37 — The activity feed is a wall of addresses** · P2
- *Where:* `activity-light-1280`: 40 rows, each starting with a hex address, with no type icon, no amount emphasis, no filters and no grouping.
- *Fix:* lead with an event glyph (buy/sell/propose/dispute/resolve) and the market. Emphasize amounts and side ("bought **42.77 No**"), with the address in muted mono at the end. Add filter chips (Trades, Resolution, Claims). Group by day.
- *Files:* `components/markets/ActivityList.tsx`, `app/activity/ActivityFeed.tsx`.
- *Acceptance:* the activity feed can be filtered to trades only, and each row's first visual element is not an address.

### Wallet and transaction feedback

**F38 — Transaction feedback is inline only, and trade progress is lost on navigation** · P1
- *Where:* `TxStatus` renders inside the panel. Approve → Buy is two separate CTA states with no step indicator. Success fires a toast, but pending and failed don't. `usePendingTxs` tracks claims only, not trades.
- *Fix:* show a 2-step indicator ("1 Approve · 2 Buy") when approval is needed. Make pending toasts persistent with a spinner and an explorer link that update in place to success or failure. Add a header pending-tx indicator (a dot on the wallet button) backed by a store that covers trades too.
- *Files:* `components/trading/TradePanel.tsx`, `components/trading/TxStatus.tsx`, `components/ui/Toast.tsx`, `hooks/usePendingTxs.ts`, `components/wallet/WalletButton.tsx`.
- *Acceptance:* after starting a buy and navigating to `/markets`, the user can still see its pending, then confirmed, state.

**F39 — The RainbowKit theme hard-codes hex values** · P2
- *Where:* `providers.tsx` duplicates `#1B1815`, `#FAF8F4`, `#332E28` and `#D6D0C5` instead of reading tokens. The modal renders light until mount (a flash in dark mode).
- *Fix:* read the CSS variables via `getComputedStyle` on mount, or use `var(--surface)` strings (RainbowKit accepts CSS values). Pass `--font-sans`.
- *Files:* `app/providers.tsx`.
- *Acceptance:* changing `--surface` in `globals.css` changes the wallet modal background.

### Theme completeness

**F40 — Dark mode has gaps** · P2
- *Where:* native selects (system chrome, `markets-vp-dark`), the inverted cream CTA slab (F08), `::selection` uses `#fff`, the yellow banner turns muddy brown (`home-dark-1280`). The success notice on `/status` uses a mint fill that will clash after F01.
- *Fix:* resolved by F02, F08 and F13. Add a `--warn` banner style that uses a border + icon rather than a fill in dark mode.
- *Files:* `globals.css`, `components/layout/DeploymentBanner.tsx`.
- *Acceptance:* every route in dark mode passes a visual check with no OS-styled controls and no surface lighter than `--surface-2`.

### Accessibility

**F41 — Broken `aria-labelledby` IDs on Discover** · P0
- *Where:* `DiscoverSections.tsx` `Section` uses `aria-labelledby={title}` / `id={title}`, so IDs like "Closing soon" and "Deepest liquidity" contain spaces. `aria-labelledby` treats a space-separated value as a list of IDs, so the section names resolve to nothing.
- *Fix:* `const id = useId()`.
- *Files:* `app/discover/DiscoverSections.tsx`.
- *Acceptance:* the axe rule `aria-valid-attr-value` passes on `/discover`, and each section has its heading as its accessible name.

**F42 — Small, low-contrast metadata text** · P2
- *Where:* 12px `--muted` (#6b655c, 5.0:1) carries meaningful data: closes-in, category, the 24h delta, stat labels. That passes AA but is hard to scan on cream.
- *Fix:* use `--ink-2` for metadata that carries data. Reserve `--muted` for decoration.
- *Files:* `components/markets/MarketRow.tsx`, `app/markets/[id]/MarketView.tsx`.
- *Acceptance:* no data-bearing text renders in `--muted` below 13px.

### Performance

**F43 — `/markets/[id]` ships about 440kB first-load JS** · P1
- *Where:* `recharts` (one step line), RainbowKit + wagmi + viem in the root provider, the full resolution feature set (Actions, ArbitrationWorkspace, EvidenceComposer) loaded for every visitor, the double `TradePanel` (F16), a 1s `setInterval` re-render in `TradePanel` even with no quote, and `useBlock({ watch: true })` on every market page.
- *Fix:*
  - replace recharts with a hand-rolled SVG step chart (about 3kB), or `next/dynamic` it with a skeleton;
  - `next/dynamic` the arbitration/evidence components, loaded only for eligible roles;
  - run the quote-age ticker only when a quote exists;
  - fix F16.
- *Files:* `components/markets/PriceChart.tsx`, `features/resolution/*`, `components/trading/TradePanel.tsx`, `app/markets/[id]/MarketView.tsx`.
- *Acceptance:* `pnpm build` reports `/markets/[id]` first-load JS under 300kB, and React Profiler shows no TradePanel commits per second while idle.

---

## Prioritized top 10

1. **Mobile header double logo** (F21): a 1-line fix, and every mobile screen is broken without it.
2. **Outcome colour remap to the split-coin rule, plus separate danger/positive tokens** (F01, F02, F05): red = YES, ink = NO, errors get their own colour. This unblocks all visual work.
3. **New split-coin logo and probability bar** (F04, F03): one component, reused as the bar, the status glyph and the slider.
4. **Single-mount TradePanel and trading-first panel redesign** (F16, F15): big outcome buttons with ¢ prices, quick amounts, slippage in a popover, payout emphasized.
5. **Home becomes a live market board** (F06, F08, F07, F10): realistic seed data, top markets above the fold, explainer cut to one strip.
6. **Motion layer** (F29, F14, F30): row stagger, hover/press feedback, animated probability digits, toast transitions, theme cross-fade, all with reduced-motion support.
7. **Command palette (⌘K / "/") with mobile entry** (F22), plus the shared Select/Chip primitives replacing native selects (F13, F31).
8. **Market page states and structure** (F17, F18, F19): outcome-first hero once resolved, a fixed chart, tabs instead of a 3,800px scroll.
9. **Correctness and a11y fixes** (F35, F41, F33, F27): chain-time relative dates, retry actions, valid labelledby IDs, 24px tooltip targets, global tabular numerals.
10. **Bundle diet for `/markets/[id]`** (F43): drop recharts, lazy-load resolution tooling, stop the idle 1s re-render; target under 300kB first-load.
