import { Status } from "@/components/ui/primitives";
import type { Stage } from "@/lib/market/stage";
import { cx } from "@/components/ui/cx";

const tone: Record<Stage, "yes" | "no" | "warn" | "muted" | "accent" | "info"> = {
  seeding: "info",
  failed: "muted",
  open: "yes",
  closed: "muted",
  proposed: "info",
  disputed: "warn",
  resolved: "accent",
  invalid: "muted",
};

/** Resolved markets show the winning side in that side's colour (red = Yes, ink = No). */
export function StageStatus({ stage, label, finalOutcome }: { stage: Stage; label: string; finalOutcome?: number | null }) {
  if (stage === "resolved" && (finalOutcome === 1 || finalOutcome === 2)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
        <span aria-hidden className={cx("size-1.5 rounded-full", finalOutcome === 1 ? "bg-yes" : "bg-no")} />
        {label}
      </span>
    );
  }
  return <Status tone={tone[stage]}>{label}</Status>;
}
