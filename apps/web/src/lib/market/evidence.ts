import { keccak256, toBytes } from "viem";
import { z } from "zod";

/** Exact message a wallet signs to attach a community evidence link. Shared by client and server. */
export const evidenceMessage = (marketId: number, url: string, note: string) =>
  `MEZONK evidence submission\nMarket: ${marketId}\nURL: ${url}\nNote: ${note}`;

/**
 * Evidence document v1. The proposer, challenger or arbitrator publishes this JSON and commits
 * keccak256(raw) on-chain with their action. A link is only as durable as its host: the hash proves
 * what the submitter *said*, not that a linked page still shows the same content.
 */
export const EVIDENCE_KINDS = ["proposal", "dispute", "arbitration"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

const httpsUrl = z
  .string()
  .trim()
  .max(400)
  .url()
  .refine((u) => {
    try {
      const x = new URL(u);
      return x.protocol === "https:" && !x.username && !x.password;
    } catch {
      return false;
    }
  }, "Use a plain https:// link");

export const evidenceLinkSchema = z.object({
  url: httpsUrl,
  label: z.string().trim().max(80).default(""),
  /** Optional SHA-256 of the linked file, as claimed by the submitter. Not verified by MEZONK. */
  sha256: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, "SHA-256 must be 64 hex characters")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const evidenceDocSchema = z.object({
  v: z.literal(1),
  kind: z.enum(EVIDENCE_KINDS),
  marketId: z.number().int().positive(),
  outcome: z.enum(["yes", "no", "invalid"]).optional(),
  summary: z.string().trim().min(20, "Explain your reasoning in at least 20 characters").max(2000),
  links: z.array(evidenceLinkSchema).min(1, "Add at least one evidence link").max(5),
  author: z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((a) => a.toLowerCase()),
  createdAt: z.string().datetime(),
});
export type EvidenceDoc = z.infer<typeof evidenceDocSchema>;

/** Deterministic serialization. Fixed key order, no whitespace. */
export function serializeEvidence(d: EvidenceDoc): string {
  return JSON.stringify({
    v: d.v,
    kind: d.kind,
    marketId: d.marketId,
    ...(d.outcome ? { outcome: d.outcome } : {}),
    summary: d.summary,
    links: d.links.map((l) => ({ url: l.url, label: l.label, ...(l.sha256 ? { sha256: l.sha256.toLowerCase() } : {}) })),
    author: d.author,
    createdAt: d.createdAt,
  });
}

export const evidenceHash = (raw: string) => keccak256(toBytes(raw));

export function parseEvidence(raw: string): EvidenceDoc | null {
  try {
    const r = evidenceDocSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : null;
  } catch {
    return null;
  }
}

export const outcomeToCode = { yes: 1, no: 2, invalid: 3 } as const;
