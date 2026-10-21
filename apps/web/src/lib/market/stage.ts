/** Lifecycle derivation shared by server and client. Mirrors MezonkExchange._stage + MezonkResolution rules. */

export const OUTCOME = { None: 0, Yes: 1, No: 2, Invalid: 3 } as const;
export type OutcomeCode = (typeof OUTCOME)[keyof typeof OUTCOME];
export const outcomeLabel = (o: number | null | undefined) =>
  o === 1 ? "Yes" : o === 2 ? "No" : o === 3 ? "Invalid" : "—";

export const FINALIZE_REASON = ["Undisputed", "Arbitrated", "No proposal in time", "Arbitrator missed deadline"];

/** seeding: published, collecting funded seed orders, no trading. failed: seeding deadline passed; refunds only. */
export type Stage = "seeding" | "failed" | "open" | "closed" | "proposed" | "disputed" | "resolved" | "invalid";

export interface StageInput {
  closeTime: Date | string;
  /** Order-book markets only; v1 markets omit both and are live from creation. */
  seedingDeadline?: Date | string | null;
  graduatedAt?: Date | string | null;
  proposalWindow: number;
  proposedAt?: Date | string | null;
  challengeDeadline?: Date | string | null;
  disputedAt?: Date | string | null;
  arbitrationDeadline?: Date | string | null;
  finalOutcome?: number | null;
}

export interface StageInfo {
  stage: Stage;
  label: string;
  /** Anyone may call finalize() now. */
  finalizable: boolean;
  /** Next deadline relevant to this stage. */
  deadline: Date | null;
  deadlineLabel: string | null;
}

const d = (v: Date | string | null | undefined) => (v ? new Date(v) : null);

export function deriveStage(m: StageInput, now = Date.now()): StageInfo {
  const close = new Date(m.closeTime);
  if (m.finalOutcome != null) {
    return m.finalOutcome === OUTCOME.Invalid
      ? { stage: "invalid", label: "Invalid · refunds open", finalizable: false, deadline: null, deadlineLabel: null }
      : {
          stage: "resolved",
          label: `Resolved ${outcomeLabel(m.finalOutcome)}`,
          finalizable: false,
          deadline: null,
          deadlineLabel: null,
        };
  }
  const seedingDeadline = d(m.seedingDeadline);
  if (seedingDeadline && !d(m.graduatedAt)) {
    return now > seedingDeadline.getTime()
      ? { stage: "failed", label: "Seeding failed · refunds open", finalizable: false, deadline: null, deadlineLabel: null }
      : { stage: "seeding", label: "Seeding", finalizable: false, deadline: seedingDeadline, deadlineLabel: "Seeding ends" };
  }
  const disputed = d(m.disputedAt);
  if (disputed) {
    const dl = d(m.arbitrationDeadline);
    return {
      stage: "disputed",
      label: "Disputed",
      finalizable: !!dl && now >= dl.getTime(),
      deadline: dl,
      deadlineLabel: "Arbitration deadline",
    };
  }
  const proposed = d(m.proposedAt);
  if (proposed) {
    const dl = d(m.challengeDeadline);
    return {
      stage: "proposed",
      label: "Outcome proposed",
      finalizable: !!dl && now >= dl.getTime(),
      deadline: dl,
      deadlineLabel: "Challenge window ends",
    };
  }
  if (now >= close.getTime()) {
    const dl = new Date(close.getTime() + m.proposalWindow * 1000);
    return {
      stage: "closed",
      label: "Awaiting outcome",
      finalizable: now >= dl.getTime(),
      deadline: dl,
      deadlineLabel: "Proposal deadline",
    };
  }
  return { stage: "open", label: "Live", finalizable: false, deadline: close, deadlineLabel: "Trading closes" };
}
