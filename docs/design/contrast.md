# MEZONK contrast (WCAG 2.x, computed from the hex values)

Design tokens: `apps/web/src/app/globals.css`. All text pairs pass 4.5:1 and all UI glyph pairs pass 3:1.
YES and NO are never told apart by colour alone: every Yes/No control and value carries its label.

| theme | pair | ratio | need |
|---|---|---|---|
| light | text on bg | 19.16 | 4.5 |
| light | text on surface | 18.20 | 4.5 |
| light | muted on surface | 7.35 | 4.5 |
| light | subtle on surface | 5.24 | 4.5 |
| light | primary on bg | 6.32 | 4.5 |
| light | primary on primary-subtle | 5.72 | 4.5 |
| light | on-primary on primary | 6.32 | 4.5 |
| light | on-no on no | 19.16 | 4.5 |
| light | border-strong on surface | 3.01 | 3 |
| light | focus on surface | 6.00 | 3 |
| light | gain / loss / warning / danger / info / success on surface | 5.32 / 5.79 / 5.34 / 7.46 / 5.61 / 5.89 | 4.5 |
| light | on-primary on primary-hover / pressed | 7.83 / 9.67 | 4.5 |
| dark | text on bg | 18.17 | 4.5 |
| dark | text on surface | 17.07 | 4.5 |
| dark | muted on surface | 8.65 | 4.5 |
| dark | subtle on surface | 6.02 | 4.5 |
| dark | primary on bg | 6.23 | 4.5 |
| dark | primary on primary-subtle | 5.03 | 4.5 |
| dark | on-primary on primary | 6.23 | 4.5 |
| dark | on-no on no | 18.17 | 4.5 |
| dark | border-strong on surface | 3.12 | 3 |
| dark | focus on surface | 9.22 | 3 |
| dark | gain / loss / warning / danger / info / success on surface | 9.85 / 6.96 / 10.57 / 6.44 / 8.84 / 9.86 | 4.5 |
| dark | on-primary on primary-hover / pressed | 7.58 / 5.29 | 4.5 |
| both | YES vs NO fill (distinctness, not a WCAG pair) | 3.03 / 2.92 | labelled always |
