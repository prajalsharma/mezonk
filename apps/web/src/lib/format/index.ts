import { formatUnits } from "viem";

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** MUSD amount (18 decimals) → "1,234.56". Small values keep precision instead of rounding to 0. */
export function formatMusd(wei: bigint | string | null | undefined, opts: { compact?: boolean } = {}): string {
  if (wei === null || wei === undefined) return "—";
  const v = Number(formatUnits(BigInt(wei), 18));
  if (opts.compact && Math.abs(v) >= 10_000) return compact.format(v);
  if (v !== 0 && Math.abs(v) < 0.01) return v < 0 ? "> -0.01" : "< 0.01";
  return nf(2, 2).format(v);
}

export const formatShares = (wei: bigint | string) => nf(0, 2).format(Number(formatUnits(BigInt(wei), 18)));

/** Probability 0..1 → "62%" (or "62.4%" when precise). */
export function formatProb(p: number, precise = false): string {
  if (!Number.isFinite(p)) return "—";
  const pct = p * 100;
  if (pct > 0 && pct < 1) return "<1%";
  if (pct < 100 && pct > 99) return ">99%";
  return `${precise ? nf(1, 1).format(pct) : Math.round(pct)}%`;
}

/** Price per share in MUSD, e.g. 0.62 */
export const formatPrice = (p: number) => nf(2, 3).format(p);

export const formatPct = (x: number, digits = 2) => `${x >= 0 ? "" : "−"}${nf(0, digits).format(Math.abs(x * 100))}%`;

export const shortAddress = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
export function relativeTime(date: Date | number, now = Date.now()): string {
  const t = typeof date === "number" ? date : date.getTime();
  const s = Math.round((t - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 86400 * 45) return rtf.format(Math.round(s / 86400), "day");
  return rtf.format(Math.round(s / (86400 * 30)), "month");
}

export const formatDateTime = (d: Date | number) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(d);

export const formatDuration = (secs: number) => {
  if (secs % 86400 === 0) return `${secs / 86400} day${secs === 86400 ? "" : "s"}`;
  if (secs % 3600 === 0) return `${secs / 3600} hour${secs === 3600 ? "" : "s"}`;
  // Countdowns: largest two units, never "7941 minutes".
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d} day${d === 1 ? "" : "s"}`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h} hour${h === 1 ? "" : "s"}`;
  return `${Math.max(1, m)} minute${m === 1 ? "" : "s"}`;
};

/** Cents as a price label: 55 → "55¢". */
export const formatCents = (c: number | null | undefined) => (c == null ? "—" : `${c}¢`);

/**
 * The single number a card shows for "what the market thinks", with its provenance. Only a real fill is a
 * price; a book midpoint is labelled indicative; with neither there is no number.
 */
export function marketSignal(m: { priceYes: number | null; bestBid: number | null; bestAsk: number | null }):
  | { kind: "trade"; p: number }
  | { kind: "indicative"; p: number }
  | { kind: "none" } {
  if (m.priceYes != null) return { kind: "trade", p: m.priceYes };
  if (m.bestBid != null && m.bestAsk != null) return { kind: "indicative", p: (m.bestBid + m.bestAsk) / 200 };
  return { kind: "none" };
}
