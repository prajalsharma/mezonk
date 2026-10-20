"use client";

import { useId, useState, type ReactNode } from "react";
import { AlertTriangle, Info, CircleCheck, CircleX } from "lucide-react";
import { cx } from "./cx";

/** Loading placeholder that keeps layout stable. */
export function Skeleton({ className }: { className?: string }) {
  return <span aria-hidden className={cx("block rounded-sm bg-surface-2 animate-[skeleton_1.6s_ease-in-out_infinite]", className)} />;
}

type Tone = "info" | "warn" | "error" | "success";
const toneStyle: Record<Tone, string> = {
  info: "bg-surface-2 border-line text-ink",
  warn: "bg-warn-soft border-warn/40 text-ink",
  error: "bg-danger-soft border-danger/40 text-ink",
  success: "bg-success-soft border-success/40 text-ink",
};
const toneIcon: Record<Tone, ReactNode> = {
  info: <Info className="size-4 text-info" aria-hidden />,
  warn: <AlertTriangle className="size-4 text-warn" aria-hidden />,
  error: <CircleX className="size-4 text-danger" aria-hidden />,
  success: <CircleCheck className="size-4 text-success" aria-hidden />,
};

/** Inline notice. Tone is conveyed by icon and wording, not colour alone. */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cx("flex gap-3 rounded-md border px-4 py-3.5 text-sm", toneStyle[tone], className)}
    >
      <span className="mt-0.5 shrink-0">{toneIcon[tone]}</span>
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-2">{children}</div>}
        {action && <div className="pt-1">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("grid-bg relative rounded-lg border border-line bg-surface px-6 py-14 text-center", className)}>
      <p className="text-lg font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-ink-2">{children}</div>}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Contextual explanation. Opens on hover, focus or tap; described-by for screen readers. */
export function Hint({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={id}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex size-4 items-center justify-center rounded-full border border-line text-[10px] font-semibold text-muted hover:text-ink"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className={cx(
          "absolute bottom-full left-1/2 z-[var(--z-tooltip)] mb-2 w-64 -translate-x-1/2 rounded-md border border-line bg-surface px-3 py-2 text-xs font-normal leading-relaxed text-ink-2 shadow-2",
          open ? "block" : "sr-only",
        )}
      >
        {children}
      </span>
    </span>
  );
}

/** A coloured dot plus a word. Used for status instead of pills. */
export function Status({ tone, children }: { tone: "yes" | "no" | "warn" | "muted" | "accent" | "info" | "success" | "danger"; children: ReactNode }) {
  const dot = {
    yes: "bg-yes",
    no: "bg-no",
    warn: "bg-warn",
    muted: "bg-muted",
    accent: "bg-accent",
    info: "bg-info",
    success: "bg-success",
    danger: "bg-danger",
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-ink-2">
      <span aria-hidden className={cx("size-1.5 rounded-full", dot)} />
      {children}
    </span>
  );
}

export function KeyValue({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="flex items-center gap-1.5 text-ink-2">
        {label}
        {hint}
      </dt>
      <dd className="tnum text-right font-medium text-ink">{children}</dd>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; className?: string }>;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx("grid gap-1 rounded-md border border-line bg-sunk p-1", className)} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "h-9 rounded-sm px-3 text-sm font-medium transition-[background-color,color,box-shadow] duration-150",
              active ? cx("bg-surface-2 text-ink shadow-1 ring-1 ring-line", o.className) : "text-muted hover:text-ink",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  htmlFor: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-line bg-sunk px-3.5 py-2.5 text-base text-ink placeholder:text-muted " +
  "transition-[border-color,box-shadow,background-color] duration-150 hover:border-ink-2/40 focus:border-accent focus:bg-surface focus:outline-none " +
  "focus:shadow-[0_0_0_4px_var(--accent-soft)] aria-[invalid=true]:border-danger disabled:opacity-50";
