import { keccak256, toBytes } from "viem";
import { z } from "zod";

/**
 * Market metadata v1. Emitted in full in the MarketCreated event; its keccak256 is stored
 * on-chain, so anyone can check that the rules shown in the app are the ones committed at creation.
 */

export const CATEGORIES = ["crypto", "defi", "bitcoin", "technology", "economics", "sports", "other"] as const;
export type Category = (typeof CATEGORIES)[number];

export const categoryLabel: Record<Category, string> = {
  crypto: "Crypto",
  defi: "DeFi",
  bitcoin: "Bitcoin",
  technology: "Technology",
  economics: "Economics",
  sports: "Sports",
  other: "Other",
};

const httpsUrl = z
  .string()
  .trim()
  .url()
  .refine((u) => u.startsWith("https://"), "Use an https:// link");

export const metadataSchema = z.object({
  v: z.literal(1),
  question: z.string().trim().min(15).max(160),
  category: z.enum(CATEGORIES),
  description: z.string().trim().max(1200).default(""),
  rules: z.object({
    yes: z.string().trim().min(20).max(600),
    no: z.string().trim().min(20).max(600),
    invalid: z.string().trim().min(20).max(600),
    ambiguity: z.string().trim().max(600).default(""),
  }),
  source: z.object({
    name: z.string().trim().min(2).max(80),
    url: httpsUrl,
  }),
  /** ISO timestamp when the event is evaluated. May be after trading closes, never before. */
  resolvesAt: z.string().datetime(),
});

export type MarketMetadata = z.infer<typeof metadataSchema>;

/** Deterministic serialization: fixed key order, no whitespace. */
export function serializeMetadata(m: MarketMetadata): string {
  const ordered = {
    v: m.v,
    question: m.question,
    category: m.category,
    description: m.description,
    rules: { yes: m.rules.yes, no: m.rules.no, invalid: m.rules.invalid, ambiguity: m.rules.ambiguity },
    source: { name: m.source.name, url: m.source.url },
    resolvesAt: m.resolvesAt,
  };
  return JSON.stringify(ordered);
}

export const metadataHash = (raw: string) => keccak256(toBytes(raw));

/** Parse metadata from chain. Returns null when it doesn't match the v1 schema (shown as "unstructured"). */
export function parseMetadata(raw: string): MarketMetadata | null {
  try {
    const r = metadataSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

const VAGUE = [
  /\bsoon\b/i,
  /\bsignificant(ly)?\b/i,
  /\ba lot\b/i,
  /\bmajor\b/i,
  /\bpopular\b/i,
  /\bsuccessful\b/i,
  /\bbig\b/i,
  /\bmoon\b/i,
];

export interface QualityIssue {
  field: string;
  message: string;
  blocking: boolean;
}

/** Heuristic checks run before creation. Blocking issues disable the publish button. */
export function reviewMetadata(m: MarketMetadata, closeTime: Date): QualityIssue[] {
  const issues: QualityIssue[] = [];
  if (!m.question.trim().endsWith("?")) {
    issues.push({ field: "question", message: "Phrase the market as a yes/no question ending in “?”.", blocking: true });
  }
  for (const re of VAGUE) {
    const hit = [m.question, m.rules.yes, m.rules.no].find((t) => re.test(t));
    if (hit) {
      issues.push({
        field: "rules",
        message: `“${hit.match(re)![0]}” is open to interpretation. Replace it with a number, date or named source.`,
        blocking: true,
      });
    }
  }
  if (!/\d/.test(m.question + m.rules.yes)) {
    issues.push({
      field: "rules",
      message: "Most resolvable markets include a number or date. Check that YES has a measurable threshold.",
      blocking: false,
    });
  }
  if (m.rules.yes.trim().toLowerCase() === m.rules.no.trim().toLowerCase()) {
    issues.push({ field: "rules", message: "YES and NO conditions must differ.", blocking: true });
  }
  if (new Date(m.resolvesAt).getTime() < closeTime.getTime()) {
    issues.push({
      field: "resolvesAt",
      message: "The event is evaluated before trading closes. Close trading at or before the resolution time.",
      blocking: true,
    });
  }
  return issues;
}
