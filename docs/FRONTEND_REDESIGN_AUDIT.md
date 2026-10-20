# Frontend redesign audit (2026-10-20)

Method: the running app (local fork, seeded with 6 real markets plus E2E markets) was screenshotted with Playwright at
1440 / 820 / 390 px in light and dark: `/`, `/discover`, `/markets`, `/markets/1`, `/markets/5`, `/suggest`, `/proposals`,
`/portfolio`, `/resolve`, `/docs` (60 images). Findings below are from those images plus the source.

## The core problem

Every screen is the same object: a cream page (`#F2EFE9`) with text rows separated by hairlines. There is one layout
primitive (the "row") and one surface. Nothing signals that this is a market: no price tiles, no outcome buttons, no
charts outside the detail page, no sense of activity. The "pale yellow" complaint is literal: `--bg` is cream, `--surface`
is cream, and the local-fork banner is a full-width yellow band (`--warn-soft`) under the header.

## Screen by screen

| Screen | Generic / unfinished | Inconsistent | Hard to scan / missing trust | Keep | Rebuild as |
|---|---|---|---|---|---|
| Header | Edge-to-edge bar, text links only | Yellow fork band reads as a site-wide warning | Network state is a 9px dot | ⌘K palette, role-aware links | Floating glass dock, neutral fork chip |
| Landing | Text hero + a bordered list of 3 rows; then 3 text-only "2-column essay" sections; 1 dark CTA slab | Three sections use the same `1fr 2fr` heading/body grid | No price, no outcome buttons, no chart, nothing clickable except two CTAs | Honest copy, worked example, trust points | Editorial hero with a real featured market ticket (live chart), live ticker, market board of cards, lifecycle rail, proof grid |
| Market cards | Don't exist: markets are rows (`MarketRow`) | Row on landing differs from row on discover | Probability is a 6px bar; Yes/No prices hidden; no way to pick a side from a list | Data fields, honesty labels (thin liquidity, unstructured rules) | `MarketCard`: category glyph, question, big odds, Yes/No price buttons (deep-link to the side), volume/closing footer, resolved state |
| Discover | Six stacked lists, most empty on a young deployment | Sidebar copy duplicates landing | Empty sections dominate the page | Ranking logic and hints | Category rail + sections rendered as card grids, empty sections collapse to one line |
| Markets | Filter bar + rows | Native-looking selects | Fine for scanning, but no visual anchor | Filters, URL state | Cards by default, dense table on toggle |
| Market detail | One long column: odds → chart → rules → resolution → activity → details | Chart is a thin grey line on cream; stat strip has no grouping | Trade panel is a plain form; outcome prices small; no in-page navigation on a 3,000px page | Every data point, resolution panel, rules-hash proof | Hero band + two outcome tiles (clickable, drive the trade panel) + framed chart + sticky section nav + restyled trade ticket |
| Suggest / Curate / Proposals / Portfolio / Resolve | Forms and lists on cream; acceptable structure | Inputs 40px, 6px radius, default-looking selects | — | All flows and copy | Inherit the new surfaces, inputs, buttons, segmented controls |
| Footer | 2-column link farm in cream | — | — | Contract/network facts | Dark band with brand lockup, grouped links, chain facts |
| States | Skeletons exist; empty states are dashed boxes | — | — | Wording | Same wording, new surfaces |

## Removed

- Cream canvas and cream surfaces as the default identity (both themes).
- Full-width yellow deployment band.
- Row-only market presentation on landing and discover.
