import type { SVGProps } from "react";
import { cx } from "@/components/ui/cx";

/**
 * The MEZONK Seam mark: a step line, like a price chart and an order book, cuts a square into NO (top) and YES (bottom).
 * 64-unit grid. At 16 px and below the one-step variant is used (wider gap, still reads as a step).
 *
 * variants:
 *  - auto: YES blue + NO ink that inverts on dark surfaces (--logo-* tokens)
 *  - mono: single colour (currentColor)
 *  - tile: the app icon, near-black tile with near-white + light blue
 * `animate` slides the halves together on load (landing hero only).
 */
const NO_PATH = "M0 0H64V32H44V22H18V36H0Z";
const YES_PATH = "M0 64H64V36H40V26H22V40H0Z";
const NO_PATH_SMALL = "M0 0H64V21H27V37H0Z";
const YES_PATH_SMALL = "M0 64H64V27H33V43H0Z";

export function LogoMark({
  size = 28,
  variant = "auto",
  title = "MEZONK",
  animate,
  className,
  ...props
}: Omit<SVGProps<SVGSVGElement>, "width" | "height"> & {
  size?: number;
  variant?: "auto" | "mono" | "tile";
  title?: string;
  animate?: boolean;
}) {
  const small = size <= 16;
  const no = variant === "mono" ? "currentColor" : variant === "tile" ? "#F4F5F8" : "var(--logo-no)";
  const yes = variant === "mono" ? "currentColor" : variant === "tile" ? "#528DFE" : "var(--logo-yes)";
  const halves = (
    <>
      <path d={small ? NO_PATH_SMALL : NO_PATH} fill={no} className={animate ? "seam-top" : undefined} />
      <path d={small ? YES_PATH_SMALL : YES_PATH} fill={yes} className={animate ? "seam-bottom" : undefined} />
    </>
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox={variant === "tile" ? "0 0 512 512" : "0 0 64 64"}
      fill="none"
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      className={cx("shrink-0 overflow-visible", className)}
      {...props}
    >
      {variant === "tile" ? (
        <>
          <rect width="512" height="512" rx="112" fill="#080A0E" />
          <g transform="translate(112 112) scale(4.5)">{halves}</g>
        </>
      ) : (
        halves
      )}
    </svg>
  );
}

/** The wordmark letters on the same 40-unit cap grid as the mark. */
const LETTERS: Array<[number, string, boolean?]> = [
  [0, "M0 40V0H8.5L22 22L35.5 0H44V40H37V13L24.5 33H19.5L7 13V40Z"],
  [51, "M0 0H28V7H7V16.5H25V23.5H7V33H28V40H0Z"],
  [86, "M0 0H30V7L10.5 33H30V40H0V33L19.5 7H0Z"],
  [123, "M9 0H27A9 9 0 0 1 36 9V31A9 9 0 0 1 27 40H9A9 9 0 0 1 0 31V9A9 9 0 0 1 9 0ZM9 7A2 2 0 0 0 7 9V31A2 2 0 0 0 9 33H27A2 2 0 0 0 29 31V9A2 2 0 0 0 27 7Z", true],
  [166, "M0 0H7.5L27 27V0H34V40H26.5L7 13V40H0Z"],
  [207, "M0 0H7V17L25 0H34L15 18.5L34 40H25L10.5 23.5L7 26.5V40H0Z"],
];

export function Wordmark({ height = 14, className }: { height?: number; className?: string }) {
  return (
    <svg height={height} viewBox="0 0 241 40" aria-hidden className={cx("shrink-0", className)} fill="currentColor">
      {LETTERS.map(([x, d, evenodd]) => (
        <path key={x} d={d} transform={`translate(${x} 0)`} fillRule={evenodd ? "evenodd" : undefined} />
      ))}
    </svg>
  );
}

/** Mark + wordmark on the shared cap grid: the wordmark is 40/56 of the mark's height. */
export function Lockup({ size = 26, className, animate }: { size?: number; className?: string; animate?: boolean }) {
  return (
    <span className={cx("items-center text-ink", className ?? "inline-flex")} style={{ gap: size * 0.36 }} aria-label="MEZONK" role="img">
      <LogoMark size={size} title="" animate={animate} />
      <Wordmark height={Math.round(size * (40 / 56) * 10) / 10} />
    </span>
  );
}
