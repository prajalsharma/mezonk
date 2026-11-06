"use client";

import { createContext, useContext, useId, type ReactNode } from "react";

/*
 * Building blocks for the docs diagrams. Every diagram is an inline SVG drawn with the app's colour tokens, so it
 * follows light/dark and stays sharp at any size. Flows animate (a slow dash march) only when motion is allowed;
 * the static drawing is always complete. Tones: "mezonk" = MEZONK contracts (brand blue), "mezo" = Mezo's own
 * contracts, "user" = wallets and people, "offchain" = servers and data (dashed), "yes"/"no" = outcome shares.
 */

export type Tone = "mezonk" | "mezo" | "user" | "offchain" | "yes" | "no" | "neutral" | "danger" | "success";

const TONE: Record<Tone, { fill: string; stroke: string; text: string; sub: string }> = {
  mezonk: { fill: "var(--accent-soft)", stroke: "var(--accent)", text: "var(--ink)", sub: "var(--accent-text)" },
  mezo: { fill: "var(--warn-soft)", stroke: "var(--warn)", text: "var(--ink)", sub: "var(--warn)" },
  user: { fill: "var(--surface)", stroke: "var(--border-strong)", text: "var(--ink)", sub: "var(--muted)" },
  offchain: { fill: "var(--surface-sunk)", stroke: "var(--border-strong)", text: "var(--ink)", sub: "var(--muted)" },
  yes: { fill: "var(--yes)", stroke: "var(--yes)", text: "var(--on-yes)", sub: "var(--on-yes)" },
  no: { fill: "var(--no)", stroke: "var(--no)", text: "var(--on-no)", sub: "var(--on-no)" },
  neutral: { fill: "var(--surface-2)", stroke: "var(--border-strong)", text: "var(--ink)", sub: "var(--muted)" },
  danger: { fill: "var(--danger-soft)", stroke: "var(--danger)", text: "var(--ink)", sub: "var(--danger)" },
  success: { fill: "var(--success-soft)", stroke: "var(--success)", text: "var(--ink)", sub: "var(--success)" },
};

const FLOW: Record<Tone, string> = {
  mezonk: "var(--accent)",
  mezo: "var(--warn)",
  user: "var(--ink-2)",
  offchain: "var(--muted)",
  yes: "var(--yes)",
  no: "var(--ink)",
  neutral: "var(--ink-2)",
  danger: "var(--danger)",
  success: "var(--success)",
};

/**
 * The frame: title, the drawing, an optional legend and a caption. `width`/`height` set the viewBox; on narrow screens
 * the figure scrolls sideways instead of shrinking text below legibility (`minWidth`, px).
 */
export function Figure({
  title,
  caption,
  width,
  height,
  minWidth = 640,
  legend,
  children,
}: {
  title: string;
  caption?: ReactNode;
  width: number;
  height: number;
  minWidth?: number;
  legend?: Tone[];
  children: ReactNode;
}) {
  const id = useId().replace(/:/g, "");
  return (
    <figure className="dg not-prose my-8">
      <div className="dg-frame">
        <div className="dg-scroll">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-labelledby={`${id}-t`}
            style={{ minWidth }}
            className="block h-auto w-full"
            fontFamily="var(--font-geist), system-ui, sans-serif"
          >
            <title id={`${id}-t`}>{title}</title>
            <defs>
              {(Object.keys(FLOW) as Tone[]).map((t) => (
                <marker key={t} id={`${id}-a-${t}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M0 0 L10 5 L0 10 z" fill={FLOW[t]} />
                </marker>
              ))}
            </defs>
            <ArrowPrefix.Provider value={`${id}-a-`}>{children}</ArrowPrefix.Provider>
          </svg>
        </div>
        {legend && legend.length > 0 && (
          <ul className="dg-legend" aria-label="Legend">
            {legend.map((t) => (
              <li key={t}>
                <span aria-hidden className="dg-swatch" style={{ background: TONE[t].fill, borderColor: TONE[t].stroke }} />
                {LEGEND[t]}
              </li>
            ))}
          </ul>
        )}
      </div>
      {caption && <figcaption className="dg-caption">{caption}</figcaption>}
    </figure>
  );
}

const LEGEND: Record<Tone, string> = {
  mezonk: "MEZONK contracts",
  mezo: "Mezo contracts",
  user: "Wallets and people",
  offchain: "Off-chain (servers, data)",
  yes: "Yes shares",
  no: "No shares",
  neutral: "Other",
  danger: "Failure path",
  success: "Success path",
};

// Marker ids are per-figure (several figures share a page), passed down through context.
const ArrowPrefix = createContext("");

/** A labelled box. `sub` is a second, smaller line (an address, a function, a note). */
export function Box({
  x,
  y,
  w,
  h,
  label,
  sub,
  tone = "neutral",
  dashed,
  emphasis,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  dashed?: boolean;
  emphasis?: boolean;
}) {
  const c = TONE[tone];
  const cx = x + w / 2;
  const cy = y + h / 2;
  return (
    <g className={emphasis ? "dg-box dg-emph" : "dg-box"}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={8}
        fill={c.fill}
        stroke={c.stroke}
        strokeWidth={emphasis ? 2 : 1.25}
        strokeDasharray={dashed || tone === "offchain" ? "5 4" : undefined}
      />
      <text x={cx} y={sub ? cy - 4 : cy + 4.5} textAnchor="middle" fontSize={13.5} fontWeight={600} fill={c.text}>
        {label}
      </text>
      {sub && (
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize={11} fill={c.sub} fontFamily="var(--font-geist-mono), ui-monospace, monospace">
          {sub}
        </text>
      )}
    </g>
  );
}

/** A region boundary such as "Mezo chain" or "MEZONK server". */
export function Group({ x, y, w, h, label, tone = "neutral" }: { x: number; y: number; w: number; h: number; label: string; tone?: Tone }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={14} fill="none" stroke={FLOW[tone]} strokeOpacity={0.45} strokeDasharray="2 5" strokeLinecap="round" />
      <text x={x + 14} y={y + 20} fontSize={11.5} fontWeight={600} fill={FLOW[tone]} letterSpacing="0.02em">
        {label}
      </text>
    </g>
  );
}

/**
 * An arrow along an SVG path. `label` sits at `at` (defaults to nothing). `animated` marches the dash to show
 * direction of value or data; turn it off for relationships that aren't flows (e.g. "deploys").
 */
export function Flow({
  d,
  tone = "neutral",
  label,
  at,
  anchor = "middle",
  animated = true,
  dashed,
  both,
}: {
  d: string;
  tone?: Tone;
  label?: ReactNode;
  at?: [number, number];
  anchor?: "start" | "middle" | "end";
  animated?: boolean;
  dashed?: boolean;
  both?: boolean;
}) {
  const prefix = useContext(ArrowPrefix);
  const color = FLOW[tone];
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashed ? "4 4" : undefined}
        markerEnd={`url(#${prefix}${tone})`}
        markerStart={both ? `url(#${prefix}${tone})` : undefined}
      />
      {animated && <path d={d} fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" pathLength={100} className="dg-pulse" />}
      {label && at && <FlowLabel x={at[0]} y={at[1]} anchor={anchor}>{label}</FlowLabel>}
    </g>
  );
}

/** Text with a background chip so it stays readable on top of lines. */
export function FlowLabel({ x, y, children, anchor = "middle" }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end" }) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={anchor}
      fontSize={11.5}
      fill="var(--ink-2)"
      stroke="var(--surface)"
      strokeWidth={5}
      strokeLinejoin="round"
      paintOrder="stroke"
    >
      {children}
    </text>
  );
}

/** Free text: section notes inside a figure. */
export function Note({ x, y, children, anchor = "start", size = 12, tone }: { x: number; y: number; children: ReactNode; anchor?: "start" | "middle" | "end"; size?: number; tone?: Tone }) {
  return (
    <text x={x} y={y} textAnchor={anchor} fontSize={size} fill={tone ? FLOW[tone] : "var(--muted)"}>
      {children}
    </text>
  );
}

/** A numbered step marker (circle with a digit) for sequences. */
export function StepDot({ x, y, n, tone = "mezonk" }: { x: number; y: number; n: number; tone?: Tone }) {
  return (
    <g>
      <circle cx={x} cy={y} r={11} fill={FLOW[tone]} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={11.5} fontWeight={700} fill="var(--surface)" fontFamily="var(--font-geist-mono), ui-monospace, monospace">
        {n}
      </text>
    </g>
  );
}
