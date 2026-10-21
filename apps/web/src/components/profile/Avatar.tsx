import { cx } from "@/components/ui/cx";

/** Deterministic two-tone fallback from the address, so every wallet is recognisable without an upload. */
function hues(address: string): [number, number] {
  const h = parseInt(address.slice(2, 8), 16) || 0;
  return [h % 360, (h >> 9) % 360];
}

export function Avatar({ address, url, size = 32, className, label }: { address: string; url?: string | null; size?: number; className?: string; label?: string }) {
  const [a, b] = hues(address.toLowerCase());
  return (
    <span
      className={cx("inline-flex shrink-0 overflow-hidden rounded-full ring-1 ring-line", className)}
      style={{ width: size, height: size, background: url ? undefined : `linear-gradient(135deg, hsl(${a} 70% 55%), hsl(${b} 70% 35%))` }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" width={size} height={size} className="size-full object-cover" loading="lazy" decoding="async" />
      )}
    </span>
  );
}
