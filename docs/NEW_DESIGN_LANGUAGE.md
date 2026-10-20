# MEZONK design language: "Night market"

```
Direction: dark-native trading surface with editorial moments (Workstation Dense data + Gallery Editorial hero)
Density:   comfortable for discovery, compact inside panels
Surface:   midnight canvas → raised panels → glass only on floating chrome
Type mood: italic serif display, precise grotesk UI, mono numbers
Motion:    fast springs on input, slow reveals on mount, nothing loops except the ticker
Do:        real data only · odds as the hero of every card · one accent · mono for every number · visible rules
Don't:     cream canvas · glass on content cards · gradients on text · fake activity · red meaning "loss"
```

## First five seconds
"This is a live market for things I have an opinion on." The hero puts one real market in front of you with its odds,
its chart and two buttons; a ticker of real markets moves underneath. You can act before you scroll.

## Making markets interesting without faking activity
Specific questions, big odds, 24h move, volume and traders when they exist. When a market has no trades the card says
"No trades yet" and shows the opening odds; the ticker hides when there is nothing open.

## Status language
- **Live**: red pulsing dot + "Live", outcome buttons enabled.
- **Closing soon** (<48h): amber "Closes in 6h" chip.
- **Resolving**: violet-grey "Resolving · proposed Yes" chip; buttons replaced by the resolution step.
- **Resolved**: outcome banner ("Resolved Yes") replaces the buttons; Invalid shows "Invalid · 0.5 per share".
- **Suggestion** (proposal): dashed outline card, no odds, status from the review workflow.

## Crypto-native, not a DeFi template
No neon gradients, no glassy cards. Identity comes from the split-coin mark, the red/ink outcome pair, mono tickers and a
faint terminal grid behind the hero. On-chain proof (rules hash, tx links) is shown as a feature.

## Surfaces
| Level | Dark | Light | Used for |
|---|---|---|---|
| Canvas | `#090C13` | `#F3F5F8` | page |
| Sunk | `#06080D` | `#E9ECF1` | inputs, chart wells |
| Panel | `#10141D` | `#FFFFFF` | cards, panels |
| Raised | `#171C27` | `#F7F8FA` | hover, selected, nested rows |
| Glass | panel @ 72% + blur | white @ 78% + blur | header dock, palette, menus, dialogs |

## Colour roles
- Accent / YES: `#FF004D` (logo red; Mezo-native). YES text `#FF4F7E` dark / `#D4003F` light.
- NO: ink half of the coin — `#E9EDF4` on dark, `#0B0F19` on light.
- Gain / success: mint `#2FD4A7` dark / `#037F5E` light. Loss / warn: amber `#FFB020` dark / `#9A5B00` light.
- Danger (errors): `#FF8A4C` dark / `#A33A0B` light — never the YES red.
- Light mode is crisp cool white, not cream. Both themes share accent, type and geometry, so personality carries over.

## Type
- Display: Instrument Serif (italic for the emphasised words) — hero H1, landing section titles only.
- UI: Geist 400/500/600.
- Numbers and data labels: Geist Mono, tabular.
- Wordmark: Hanken Grotesk 600 caps +7% (brand sheet).

## Geometry
Radius 18 (cards) / 12 (controls, inner tiles) / 8 (chips). Concentric radii on nested surfaces. 1px borders at low
contrast; elevation through surface steps, shadows only on floating layers.

## Motion
- Mount: 480ms rise with stagger (cards 40ms apart).
- Input: 120ms press scale, 180ms hover lift on cards.
- Data: odds tween over 480ms with a one-shot tint toward the side that gained.
- Ticker: 60s linear loop, pauses on hover/focus, static under reduced motion.
- Theme: 220ms colour cross-fade.

## Logo
The split coin sits in the header dock, the footer, the favicon, and as a faint oversized watermark behind the hero
ticket. Swapping the logo only touches `components/brand/Logo.tsx`.

## What makes it unmistakable
Dark midnight canvas by default; serif italic hero; real market ticket with chart as the hero object; live ticker;
card grids with outcome buttons everywhere markets are listed; outcome tiles + sticky section nav on the market page;
floating header dock; dark footer band. Side by side with the cream row layout there is nothing in common but the logo.
