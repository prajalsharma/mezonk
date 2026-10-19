# Agent skills used

No new skills were installed. The machine already had relevant, user-chosen skills; installing more from
marketplaces without review was judged riskier than useful.

| Skill | Source | Used for |
|---|---|---|
| impeccable (3.9.1) | plugin `impeccable` (user's preferred design skill) | design register, color and contrast discipline, anti-pattern checks; its edit hook scanned every UI file |
| ui-ux-pro-max, design-taste-frontend | `~/.claude/skills` (user-provided) | available as reference; impeccable was the primary guide |
| solidity-auditor | `~/.claude/skills` | available; manual review plus Slither used for this pass |
| Foundry, Slither, Playwright, Vitest | tools, not skills | contract tests, static analysis, E2E, unit and integration |

Limitation: no third-party audit skill output is claimed as an audit.
