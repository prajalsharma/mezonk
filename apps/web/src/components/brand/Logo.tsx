import type { SVGProps } from "react";

/**
 * The MEZONK mark: an M whose valley reads as a chart line, with a red marker dot.
 * Colours come from theme tokens, so the mark adapts to light/dark automatically:
 * stroke = --logo-stroke, dot = --logo-dot, cut-out ring = --logo-cut (page background).
 * `variant="icon"` is the app-icon treatment: cream mark, ink marker on the red field.
 */
export function LogoMark({
  size = 28,
  variant = "auto",
  title = "MEZONK",
  ...props
}: SVGProps<SVGSVGElement> & { size?: number; variant?: "auto" | "icon"; title?: string }) {
  const icon = variant === "icon";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      role="img"
      aria-label={title}
      {...props}
    >
      {icon && <rect width="96" height="96" fill="#FF004D" />}
      <path
        d="M20 78V22L48 58L76 22V78"
        stroke={icon ? "#F2EFE9" : "var(--logo-stroke)"}
        strokeWidth="10"
        strokeLinejoin="miter"
      />
      <circle
        cx="48"
        cy="60"
        r="9"
        fill={icon ? "#14110F" : "var(--logo-dot)"}
        stroke={icon ? "#FF004D" : "var(--logo-cut)"}
        strokeWidth="4"
      />
    </svg>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`wordmark ${className}`}>Mezonk</span>;
}

export function Lockup({ size = 26, className = "" }: { size?: number; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 text-ink ${className}`}>
      <LogoMark size={size} aria-hidden title="" />
      <Wordmark className="text-[1.05rem] leading-none" />
    </span>
  );
}
