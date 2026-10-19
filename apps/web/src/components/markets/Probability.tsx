import { cx } from "@/components/ui/cx";
import { formatProb } from "@/lib/format";

/**
 * YES/NO split bar. The marker is the logo's red dot, sitting at the implied YES probability.
 * Text labels always accompany the bar, so the state never relies on colour.
 */
export function ProbabilityBar({ priceYes, size = "md", className }: { priceYes: number; size?: "sm" | "md" | "lg"; className?: string }) {
  const pct = Math.min(100, Math.max(0, priceYes * 100));
  const h = size === "lg" ? "h-2.5" : size === "sm" ? "h-1.5" : "h-2";
  const dot = size === "lg" ? "size-4" : size === "sm" ? "size-2.5" : "size-3";
  return (
    <div className={cx("relative", className)} role="img" aria-label={`Yes ${formatProb(priceYes)}, No ${formatProb(1 - priceYes)}`}>
      <div className={cx("flex overflow-hidden rounded-full bg-no-soft", h)}>
        <div className="bg-yes" style={{ width: `${pct}%` }} />
      </div>
      <span
        aria-hidden
        className={cx("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-[3px] ring-bg", dot)}
        style={{ left: `${pct}%` }}
      />
    </div>
  );
}

export function OddsLabels({ priceYes, className }: { priceYes: number; className?: string }) {
  return (
    <div className={cx("tnum flex justify-between text-sm font-semibold", className)}>
      <span className="text-yes">Yes {formatProb(priceYes)}</span>
      <span className="text-no">No {formatProb(1 - priceYes)}</span>
    </div>
  );
}

export function Change({ from, to }: { from: number; to: number }) {
  const d = (to - from) * 100;
  if (Math.abs(d) < 0.5) return <span className="tnum text-muted">0 pts</span>;
  return (
    <span className={cx("tnum", d > 0 ? "text-yes" : "text-no")}>
      <span aria-hidden>{d > 0 ? "▲" : "▼"}</span>
      <span className="sr-only">{d > 0 ? "up" : "down"}</span> {Math.abs(Math.round(d))} pts
    </span>
  );
}
