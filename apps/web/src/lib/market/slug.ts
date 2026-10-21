/**
 * URL slug from a market question (docs/USER_PROFILES_AND_RBAC_ARCHITECTURE.md §9). Deterministic:
 * NFKD, strip combining marks, keep ASCII letters/digits, everything else becomes a hyphen; ≤ 72 chars
 * cut at a word boundary. Text with no ASCII letters or digits (emoji, non-Latin scripts) yields "" and
 * the caller falls back to `market-{id}`. Collisions are resolved by the caller with `-{id}`.
 */
export const SLUG_MAX = 72;

export function slugify(input: string): string {
  const ascii = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[$]/g, " ")
    .replace(/%/g, " pct ")
    .replace(/&/g, " and ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (ascii.length <= SLUG_MAX) return ascii;
  const cut = ascii.slice(0, SLUG_MAX);
  const at = cut.lastIndexOf("-");
  return (at > 20 ? cut.slice(0, at) : cut).replace(/-+$/g, "");
}

/** The slug for a market given the slugs already taken. */
export function slugForMarket(question: string, marketId: number, taken: (s: string) => boolean): string {
  const base = slugify(question) || `market-${marketId}`;
  if (/^\d+$/.test(base)) return `market-${marketId}`; // never shadow numeric ids
  if (!taken(base)) return base;
  return `${base.slice(0, SLUG_MAX - String(marketId).length - 1)}-${marketId}`;
}

export const isNumericId = (s: string) => /^[1-9]\d{0,9}$/.test(s);
