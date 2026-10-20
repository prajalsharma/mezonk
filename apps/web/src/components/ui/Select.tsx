import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { cx } from "./cx";
import { inputClass } from "./primitives";

/** Native select with the design system's chrome. Keeps native keyboard and mobile behaviour. */
export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cx("relative inline-flex", className)}>
      <select {...rest} className={cx(inputClass, "appearance-none pr-9")}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
    </span>
  );
}

/** Toggleable filter chip. Selection is conveyed by aria-pressed and a filled style. */
export function Chip({
  pressed,
  onClick,
  children,
  className,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "press shrink-0 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors duration-150",
        pressed ? "border-ink bg-primary text-on-primary" : "border-line text-ink-2 hover:border-ink-2 hover:text-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}
