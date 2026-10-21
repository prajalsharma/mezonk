import type { StoredApproval } from "./approval";
import type { ProposalStatus } from "./proposal";
import type { MarketMetadata } from "@/lib/market/metadata";

/** Wire shape of a proposal as returned by /api/proposals (see server/governance.ts publicProposal). */
export interface ProposalDto {
  id: string;
  author: string;
  projectId: string | null;
  status: ProposalStatus;
  version: number;
  metadata: MarketMetadata;
  metadataHash: string;
  closeTime: string;
  launchWindow: string;
  resolver: string | null;
  publisher: string;
  rationale: string;
  references: Array<{ url: string; label: string }>;
  sponsored: boolean;
  summary: string;
  conflicts: string;
  marketId: number | null;
  submittedAt: string | null;
  decidedAt: string | null;
  createdAt: string;
  updatedAt: string;
  assignedCurator: string | null;
  approval: StoredApproval | null;
  /** Author and curators only. */
  liquidityPlan?: string;
}

export interface ReviewDto {
  id: number;
  proposalId: string;
  proposalVersion: number;
  reviewer: string;
  action: string;
  reason: string;
  checklist: Record<string, boolean> | null;
  duplicateOf: string | null;
  internal: boolean;
  createdAt: string;
}

export interface ProposalDetailDto {
  proposal: ProposalDto;
  media: Array<{ id: string; url: string; width: number; height: number; role: string }>;
  reviews: ReviewDto[];
  project: { id: string; name: string; status: string; website: string | null } | null;
  authorIsVerifiedRep: boolean;
  check: null | {
    issues: Array<{ field: string; message: string; blocking: boolean }>;
    similarMarkets: Array<{ id: number; question: string }>;
    similarProposals: Array<{ id: string; question: string; status: string }>;
  };
}

export interface ProjectDto {
  id: string;
  name: string;
  website: string | null;
  description: string;
  status: string;
  createdBy: string;
  createdAt: string;
  verifiedAt: string | null;
  representatives: Array<{ wallet: string; status: string; proofUrl: string | null }>;
}

/** Plain-language wording for each review action, in the past tense for timelines. */
export const reviewActionLabel: Record<string, string> = {
  submit: "Submitted for review",
  resubmit: "Resubmitted after changes",
  withdraw: "Withdrawn by the author",
  claim: "Picked up for review",
  unassign: "Released back to the queue",
  assign: "Resolver and publisher assigned",
  request_changes: "Changes requested",
  reject: "Rejected",
  approve: "Approved and signed",
  note: "Note",
  publish: "Published on-chain",
};
