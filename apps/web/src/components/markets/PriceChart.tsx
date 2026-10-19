"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
    const out = before ? [{ t: cut, p: before.p }, ...inRange] : inRange;
    // Extend the last known price to now so the line reaches the present.
    if (out.length) out.push({ t: Date.now(), p: out.at(-1)!.p });
    return out;
  }, [data, range]);

  if (isLoading) return <Skeleton className="h-56 w-full" />;
  if (error || !data) {
    return <p className="flex h-56 items-center justify-center text-sm text-muted">Price history is unavailable right now.</p>;
  }
  const trades = data.points.length - 1;
  const last = series.at(-1);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          Chance of Yes · {trades === 0 ? "no trades yet, showing the opening price" : `${trades} trade${trades === 1 ? "" : "s"}`}
        </p>
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
      <div className="h-56 w-full" role="img" aria-label={`Price chart. Current chance of Yes ${last ? formatProb(last.p / 100) : "unknown"}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <XAxis
              dataKey="t"
              type="number"
              domain={["dataMin", "dataMax"]}
              scale="time"
              tickFormatter={(t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={{ stroke: "var(--border)" }}
              tickLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              tickFormatter={(v: number) => `${v}%`}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={44}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }}
              labelStyle={{ color: "var(--ink-2)" }}
              itemStyle={{ color: "var(--ink)" }}
              labelFormatter={(t) => formatDateTime(Number(t))}
              formatter={(v) => [`${Number(v).toFixed(1)}%`, "Yes"]}
            />
            <Line type="stepAfter" dataKey="p" stroke="var(--ink)" strokeWidth={1.75} dot={false} isAnimationActive={false} />
            {last && <ReferenceDot x={last.t} y={last.p} r={5} fill="var(--accent)" stroke="var(--bg)" strokeWidth={3} />}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
