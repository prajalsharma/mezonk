import type { TimelineEntry } from "@/lib/market/timeline";
import type { EvidenceDoc } from "@/lib/market/evidence";

export interface DocState {
  status: "verified" | "mismatch" | "missing";
  raw?: string;
  doc?: EvidenceDoc | null;
}

export interface ResolutionDto {
  stage: { stage: string; label: string };
  structured: boolean;
  resolver: string;
  arbitrator: string;
  creator: string;
  proposerBond: string;
  disputeBond: string;
  challengeWindow: number;
  proposalWindow: number;
  arbitrationWindow: number;
  closeTime: string;
  finalOutcome: number | null;
  finalizeReason: number | null;
  finalizedAt: string | null;
  timeline: TimelineEntry[];
  documents: Record<string, DocState>;
  communityEvidence: Array<{ id: number; author: string; url: string; note: string; createdAt: string }>;
  indexer: null | { lagBlocks: number | null; stale: boolean; lastSuccessAt: string | null; lastError: string | null };
}
