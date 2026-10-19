import { Status } from "@/components/ui/primitives";
import type { Stage } from "@/lib/market/stage";

const tone: Record<Stage, "yes" | "no" | "warn" | "muted" | "accent" | "info"> = {
  open: "yes",
  closed: "muted",
  proposed: "info",
  disputed: "warn",
  resolved: "accent",
  invalid: "muted",
};

export function StageStatus({ stage, label }: { stage: Stage; label: string }) {
  return <Status tone={tone[stage]}>{label}</Status>;
}
