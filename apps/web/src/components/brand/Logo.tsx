import type { SVGProps } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The MEZONK split coin. Red half = YES, ink half = NO; the vertical slip between them is the spread.
 * Geometry is the brand's: two half-discs of radius 34 on a 96 grid, shifted ±7.
 *
 * variants:
 *  - auto: red + ink that inverts on dark surfaces (uses --logo-* tokens)
 *  - mono: single colour (currentColor) for print-like contexts
 *  - tile-ink / tile-red: app-icon tiles with a 26/112 corner radius
 * The asset is never recoloured beyond these documented variants.
 */
export function LogoMark({
  size = 28,
  variant = "auto",
  title = "MEZONK",
  className,
  ...props
}: Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number;
  variant?: "auto" | "mono" | "tile-ink" | "tile-red";
  title?: string;
}) {
  const tile = variant === "tile-ink" || variant === "tile-red";
  const yes = variant === "auto" ? "var(--logo-red)" : variant === "mono" ? "currentColor" : variant === "tile-ink" ? "#FF004D" : "#F2EFE9";
  const no = variant === "auto" ? "var(--logo-ink)" : variant === "mono" ? "currentColor" : variant === "tile-ink" ? "#F2EFE9" : "#14110F";
  const r = tile ? (96 * 26) / 112 : 0;
  // Tiles hold the coin at 78/112 of their width, as on the brand sheet.
  const scale = tile ? 78 / 112 : 1;
  const offset = (96 - 96 * scale) / 2;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cx("shrink-0", className)}
      {...props}
    >
      {tile && <rect width="96" height="96" rx={r} fill={variant === "tile-ink" ? "#14110F" : "#FF004D"} />}
      <g transform={tile ? `translate(${offset} ${offset}) scale(${scale})` : undefined}>
        <path d="M46 14A34 34 0 0 0 46 82Z" transform="translate(0 7)" fill={yes} />
        <path d="M50 14A34 34 0 0 1 50 82Z" transform="translate(0 -7)" fill={no} />
      </g>
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={cx("wordmark", className)}>Mezonk</span>;
}

/** Mark + wordmark. Pass a display class (e.g. "hidden sm:inline-flex") to control visibility. */
export function Lockup({ size = 26, className }: { size?: number; className?: string }) {
  return (
    <span className={cx("items-center gap-2.5 text-ink", className ?? "inline-flex")}>
      <LogoMark size={size} title="" />
      <Wordmark className="text-[1.05rem] leading-none" />
    </span>
  );
}
