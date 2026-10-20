"use client";

import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { apiGet } from "@/lib/api/types";
import { formatProb } from "@/lib/format";

/**
 * Real YES-probability history for one market as a step line. Draws nothing it doesn't have:
 * with no trades it shows the flat opening price and says so.
 */
export function Sparkline({ marketId, height = 96, className }: { marketId: number; height?: number; className?: string }) {
  const gid = useId().replace(/:/g, "");
  const { data } = useQuery({
    queryKey: ["market", marketId, "history"],
    queryFn: () => apiGet<{ points: Array<{ t: string; p: number }> }>(`/api/markets/${marketId}/history`),
    refetchInterval: 20_000,
  });
  const pts = data?.points ?? [];
  if (pts.length === 0) return <div className={className} style={{ height }} aria-hidden />;
  const W = 600;
  const H = height;
  const ts = pts.map((x) => new Date(x.t).getTime());
  const t0 = ts[0]!;
  const t1 = Math.max(ts.at(-1)! + 1, t0 + 1);
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (p: number) => H - 6 - p * (H - 12);
  let d = `M0 ${y(pts[0]!.p)}`;
  pts.forEach((p, i) => {
    if (i === 0) return;
    d += ` H${x(ts[i]!).toFixed(1)} V${y(p.p).toFixed(1)}`;
  });
  d += ` H${W}`;
  const last = pts.at(-1)!;
  const trades = pts.length - 1;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className={className}
      style={{ height, width: "100%" }}
      role="img"
      aria-label={`Chance of Yes over time, ${trades} trade${trades === 1 ? "" : "s"}. Now ${formatProb(last.p)}.`}
    >
      <defs>
        <linearGradient id={`sg-${gid}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={W} y1={y(0.5)} y2={y(0.5)} stroke="var(--border)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
      <path d={`${d} V${H} H0 Z`} fill={`url(#sg-${gid})`} />
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}
