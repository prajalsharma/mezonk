import { z } from "zod";
import { metadataSchema } from "@/lib/market/metadata";

/**
 * Market proposal lifecycle (backend workflow). Publication (SCHEDULED → LIVE) is enforced on-chain.
 *
 *   draft → submitted → under_review → approved → scheduled → published
 *                          ↓               ↑
 *                  changes_requested ──(resubmit)
 *                          ↓
 *                       rejected
 *   any pre-approval state → withdrawn (by author)
 */
export const PROPOSAL_STATUS = [
  "draft",
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "scheduled",
  "published",
  "rejected",
  "withdrawn",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUS)[number];

export const statusLabel: Record<ProposalStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  scheduled: "Scheduled",
  published: "Live market",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

/** Who may trigger each transition. "author" = proposal author, "curator" = on-chain curator ≠ author. */
export const TRANSITIONS: Record<string, { from: ProposalStatus[]; to: ProposalStatus; by: "author" | "curator" | "creator" | "system" }> = {
  submit: { from: ["draft", "changes_requested"], to: "submitted", by: "author" },
  withdraw: { from: ["draft", "submitted", "under_review", "changes_requested"], to: "withdrawn", by: "author" },
  claim: { from: ["submitted"], to: "under_review", by: "curator" },
  request_changes: { from: ["submitted", "under_review"], to: "changes_requested", by: "curator" },
  reject: { from: ["submitted", "under_review"], to: "rejected", by: "curator" },
  approve: { from: ["submitted", "under_review"], to: "approved", by: "curator" },
  schedule: { from: ["approved"], to: "scheduled", by: "creator" },
  publish: { from: ["approved", "scheduled"], to: "published", by: "system" },
};

export function canTransition(action: string, from: ProposalStatus) {
  const t = TRANSITIONS[action];
  return !!t && t.from.includes(from);
}

export const OUTCOME_TYPES = ["binary"] as const;

export const proposalInputSchema = z.object({
  metadata: metadataSchema,
  outcomeType: z.enum(OUTCOME_TYPES).default("binary"),
  projectId: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/).optional().nullable(),
  closeTime: z.string().datetime(),
  launchWindow: z.string().trim().max(200).default(""),
  resolver: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().nullable(),
  liquidityPlan: z.string().trim().max(600).default(""),
  conflicts: z.string().trim().max(600).default(""),
  rationale: z.string().trim().min(20).max(1200),
  references: z
    .array(z.object({ url: z.string().url().max(400).refine((u) => u.startsWith("https://"), "https only"), label: z.string().max(80).default("") }))
    .max(8)
    .default([]),
  sponsored: z.boolean().default(false),
  /** Off-chain presentation (not hashed into the rules): a short summary and uploaded images. */
  summary: z.string().trim().max(280).default(""),
  coverMediaId: z.string().uuid().nullable().optional(),
  contextMediaIds: z.array(z.string().uuid()).max(6).default([]),
});
export type ProposalInput = z.infer<typeof proposalInputSchema>;

export const REVIEW_CHECKLIST = [
  ["objective", "The question has one objectively checkable answer"],
  ["source", "The primary source is public and appropriate"],
  ["deadline", "Deadline and timezone are explicit"],
  ["invalid", "Invalid conditions are defined"],
  ["duplicate", "Not a duplicate of an open market"],
  ["policy", "Within the market policy (no harm, no private individuals)"],
  ["conflict", "Conflicts of interest are disclosed where relevant"],
] as const;
export type ChecklistKey = (typeof REVIEW_CHECKLIST)[number][0];

export const reviewActionSchema = z.object({
  action: z.enum(["claim", "request_changes", "reject", "approve", "note", "unassign", "assign"]),
  reason: z.string().trim().max(1200).default(""),
  /** For `assign`: the on-chain resolver and the approved creator who will publish. */
  resolver: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  publisher: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  checklist: z.record(z.string(), z.boolean()).optional(),
  duplicateOf: z.string().max(64).optional(),
  internal: z.boolean().default(false),
  /** Required for approve: the EIP-712 signature over the approval the server constructs. */
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/).optional(),
  approval: z
    .object({
      metadataHash: z.string(),
      creator: z.string(),
      resolver: z.string(),
      closeTime: z.string(),
      deadline: z.string(),
      nonce: z.string(),
    })
    .optional(),
});
