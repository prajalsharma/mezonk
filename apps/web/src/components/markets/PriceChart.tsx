"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Segmented, Skeleton } from "@/components/ui/primitives";
import { apiGet } from "@/lib/api/types";
import { formatDateTime, formatProb } from "@/lib/format";

interface Point {
  t: string;
  p: number;
  tx: string;
}

const RANGES = { all: Infinity, "7d": 7 * 86400e3, "24h": 86400e3 } as const;

/** YES probability after each indexed trade. Step line: price only changes when someone trades. */
export function PriceChart({ marketId }: { marketId: number }) {
  const [range, setRange] = useState<keyof typeof RANGES>("all");
  const { data, isLoading, error } = useQuery({
    queryKey: ["market", marketId, "history"],
    queryFn: () => apiGet<{ points: Point[] }>(`/api/markets/${marketId}/history`),
    refetchInterval: 15_000,
  });

  const series = useMemo(() => {
    if (!data) return [];
    const cut = Date.now() - RANGES[range];
    const pts = data.points.map((x) => ({ t: new Date(x.t).getTime(), p: x.p * 100 }));
    const inRange = pts.filter((x) => x.t >= cut);
    const before = pts.filter((x) => x.t < cut).at(-1);
    const raw = before ? [{ t: cut, p: before.p }, ...inRange] : inRange;
    // Several trades can share a block timestamp: keep the last price per timestamp.
    const out: Array<{ t: number; p: number }> = [];
    for (const x of raw) {
      if (out.length && out.at(-1)!.t === x.t) out[out.length - 1] = x;
      else out.push(x);
    }
    // Extend the last price to the present. Chain time can run ahead of this browser's clock
    // (e.g. on a local fork), so never draw backwards.
    const end = Math.max(Date.now(), (out.at(-1)?.t ?? 0) + 60_000);
    if (out.length) out.push({ t: end, p: out.at(-1)!.p });
    return out;
  }, [data, range]);

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (error || !data) {
    return <p className="flex h-72 items-center justify-center text-sm text-muted">Price history is unavailable right now.</p>;
  }
  const trades = data.points.length; // one point per confirmed fill; there is no opening point
  const last = series.at(-1);
  if (trades === 0) {
    return (
      <div className="flex h-72 flex-col items-center justify-center gap-1 text-center">
        <p className="font-medium">No trades yet</p>
        <p className="max-w-sm text-sm text-ink-2">The chart starts at the first real fill. Until then there is no price to draw.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="label">Chance of Yes</p>
          <p className="text-sm text-ink-2">{`${trades} fill${trades === 1 ? "" : "s"} · step line, moves only on trades`}</p>
        </div>
        <Segmented
          label="Chart range"
          value={range}
          onChange={setRange}
          className="w-44"
          options={[
            { value: "24h", label: "24h" },
            { value: "7d", label: "7d" },
            { value: "all", label: "All" },
          ]}
        />
      </div>
      <div className="h-72 w-full" role="img" aria-label={`Price chart. Current chance of Yes ${last ? formatProb(last.p / 100) : "unknown"}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <defs>
              <linearGradient id={`pc-${marketId}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.24} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 6" />
            <ReferenceLine y={50} stroke="var(--border)" />
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              scale="time"
              tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              tick={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-geist-mono)" }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              minTickGap={40}
              allowDuplicatedCategory={false}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-geist-mono)" }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12, fontSize: 12, boxShadow: "var(--shadow-2)" }}
              labelStyle={{ color: "var(--ink-2)" }}
              itemStyle={{ color: "var(--ink)" }}
              labelFormatter={(t) => formatDateTime(Number(t))}
              formatter={(v) => [`${Number(v).toFixed(1)}%`, "Yes"]}
            />
            <Area type="stepAfter" dataKey="p" stroke="var(--accent)" strokeWidth={2} fill={`url(#pc-${marketId})`} dot={false} isAnimationActive={false} />
            {last && <ReferenceDot x={last.t} y={last.p} r={5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={3} />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
