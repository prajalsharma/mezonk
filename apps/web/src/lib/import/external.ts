/**
 * Reads Bitcoin markets from public prediction-market APIs (Polymarket's Gamma API and Kalshi's trade API v2).
 * Pure parsers plus thin fetchers. No keys: both endpoints are public and read-only.
 *
 * The parsers are defensive on purpose: every field is checked, anything unexpected is dropped with a reason, and
 * nothing is filled in by guess. Kalshi has served prices both as integer cents (`yes_bid`) and as dollar strings
 * (`yes_bid_dollars`); both are accepted.
 */

export type ExternalSource = "polymarket" | "kalshi";

export const sourceName: Record<ExternalSource, string> = { polymarket: "Polymarket", kalshi: "Kalshi" };

export interface ExternalMarket {
  source: ExternalSource;
  /** Polymarket market slug or Kalshi ticker: what we look the market up by later. */
  id: string;
  /** A page a person can open. */
  url: string;
  /** Their question, as they word it. */
  title: string;
  /** Short extra label: Polymarket `groupItemTitle`, Kalshi `yes_sub_title`. */
  label: string;
  /** Their rules text (used only to detect "at any time" questions). */
  rules: string;
  /** When their outcome is measured. */
  evaluatesAt: Date;
  /** Yes probability 0..1 from their order book (midpoint when the spread is tight, else last price). */
  probYes: number | null;
  /** 24h volume: USD on Polymarket, contracts ($1 payout each) on Kalshi. */
  volume24h: number;
  /** Kalshi only: structured strike. */
  strike?: { type: string; floor: number | null; cap: number | null };
  /** Polymarket only: the official source the question resolves on (an https URL), its event and the event's tags. */
  resolutionSource?: string;
  eventId?: string;
  tags?: string[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const date = (v: unknown): Date | null => {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Gamma encodes arrays as JSON strings (`"[\"Yes\", \"No\"]"`); accept real arrays too. */
function jsonArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

/** Midpoint when both sides exist and the spread is at most 10 points; otherwise the fallback (last/display price). */
function probability(bid: number | null, ask: number | null, fallback: number | null): number | null {
  if (bid != null && ask != null && bid > 0 && ask < 1 && ask > bid && ask - bid <= 0.1) return (bid + ask) / 2;
  return fallback != null && fallback > 0 && fallback < 1 ? fallback : null;
}

export interface Skipped {
  source: ExternalSource;
  id: string;
  title: string;
  reason: string;
}

/** Parse a Gamma `/events` response (each event holds its markets). */
export function parsePolymarketEvents(body: unknown): { markets: ExternalMarket[]; skipped: Skipped[] } {
  const markets: ExternalMarket[] = [];
  const skipped: Skipped[] = [];
  if (!Array.isArray(body)) return { markets, skipped };
  for (const e of body as Array<Record<string, unknown>>) {
    const eventSlug = str(e.slug);
    const tags = (Array.isArray(e.tags) ? e.tags : [])
      .map((t) => (typeof t === "string" ? t : str((t as Record<string, unknown>)?.slug) || str((t as Record<string, unknown>)?.label)))
      .filter(Boolean)
      .map((t) => t.toLowerCase());
    for (const m of (Array.isArray(e.markets) ? e.markets : []) as Array<Record<string, unknown>>) {
      const id = str(m.slug);
      const title = str(m.question) || str(e.title);
      const skip = (reason: string) => skipped.push({ source: "polymarket", id, title, reason });
      if (!id || !title) continue;
      if (m.closed === true || m.active === false || m.archived === true) { skip("closed or inactive"); continue; }
      const outcomes = jsonArray(m.outcomes).map(String);
      if (outcomes.length !== 2 || outcomes[0] !== "Yes" || outcomes[1] !== "No") { skip("not a Yes/No market"); continue; }
      const at = date(m.endDate) ?? date(e.endDate);
      if (!at) { skip("no end date"); continue; }
      const prices = jsonArray(m.outcomePrices).map(num);
      markets.push({
        source: "polymarket",
        id,
        url: eventSlug ? `https://polymarket.com/event/${eventSlug}` : `https://polymarket.com/market/${id}`,
        title,
        label: str(m.groupItemTitle),
        rules: str(m.description) || str(e.description),
        evaluatesAt: at,
        probYes: probability(num(m.bestBid), num(m.bestAsk), prices[0] ?? null),
        volume24h: num(m.volume24hr) ?? 0,
        resolutionSource: str(m.resolutionSource) || str(e.resolutionSource),
        eventId: str(e.id) || eventSlug,
        tags,
      });
    }
  }
  return { markets, skipped };
}

/** Kalshi prices: dollar strings ("0.6200") or integer cents (62). Returns 0..1. */
function kalshiPrice(m: Record<string, unknown>, field: string): number | null {
  const d = num(m[`${field}_dollars`]);
  if (d != null) return d;
  const c = num(m[field]);
  return c != null ? c / 100 : null;
}

/** Parse a Kalshi `/markets` response. */
export function parseKalshiMarkets(body: unknown): { markets: ExternalMarket[]; skipped: Skipped[] } {
  const markets: ExternalMarket[] = [];
  const skipped: Skipped[] = [];
  const list = (body as { markets?: unknown })?.markets;
  if (!Array.isArray(list)) return { markets, skipped };
  for (const m of list as Array<Record<string, unknown>>) {
    const id = str(m.ticker);
    const title = str(m.title);
    const skip = (reason: string) => skipped.push({ source: "kalshi", id, title, reason });
    if (!id || !title) continue;
    const status = str(m.status);
    if (status && !["active", "open"].includes(status)) { skip(`status ${status}`); continue; }
    if (str(m.market_type) && str(m.market_type) !== "binary") { skip("not binary"); continue; }
    const at = date(m.close_time);
    if (!at) { skip("no close time"); continue; }
    const series = (str(m.event_ticker) || id).split("-")[0] ?? id;
    markets.push({
      source: "kalshi",
      id,
      url: `https://kalshi.com/markets/${series.toLowerCase()}`,
      title,
      label: str(m.yes_sub_title) || str(m.subtitle),
      rules: [str(m.rules_primary), str(m.rules_secondary)].filter(Boolean).join(" "),
      evaluatesAt: at,
      probYes: probability(kalshiPrice(m, "yes_bid"), kalshiPrice(m, "yes_ask"), kalshiPrice(m, "last_price")),
      volume24h: num(m.volume_24h) ?? num(m.volume_24h_fp) ?? 0,
      strike: { type: str(m.strike_type), floor: num(m.floor_strike), cap: num(m.cap_strike) },
    });
  }
  return { markets, skipped };
}

export const POLYMARKET_API = "https://gamma-api.polymarket.com";
export const KALSHI_API = "https://api.elections.kalshi.com/trade-api/v2";
/** Kalshi series with Bitcoin price markets. Only point-in-time "above/below" ones are used; the rest are skipped. */
export const DEFAULT_KALSHI_SERIES = ["KXBTCD", "KXBTC", "KXBTCMAXY", "KXBTCMINY"];

async function getJson(url: string, timeoutMs = 20_000): Promise<unknown> {
  const r = await fetch(url, { headers: { accept: "application/json", "user-agent": "mezonk-importer/1" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}`);
  return r.json();
}

export async function fetchPolymarketBitcoin(limit = 50) {
  const q = new URLSearchParams({ closed: "false", active: "true", tag_slug: "bitcoin", order: "volume24hr", ascending: "false", limit: String(limit) });
  return parsePolymarketEvents(await getJson(`${POLYMARKET_API}/events?${q}`));
}

/** The most traded open events across every topic (for the monthly picks beyond Bitcoin). */
export async function fetchPolymarketTop(limit = 100) {
  const q = new URLSearchParams({ closed: "false", active: "true", order: "volume24hr", ascending: "false", limit: String(limit) });
  return parsePolymarketEvents(await getJson(`${POLYMARKET_API}/events?${q}`));
}

export async function fetchKalshiBitcoin(series = DEFAULT_KALSHI_SERIES) {
  const out = { markets: [] as ExternalMarket[], skipped: [] as Skipped[], errors: [] as string[] };
  for (const s of series) {
    try {
      const r = parseKalshiMarkets(await getJson(`${KALSHI_API}/markets?${new URLSearchParams({ series_ticker: s, status: "open", limit: "200" })}`));
      out.markets.push(...r.markets);
      out.skipped.push(...r.skipped);
    } catch (e) {
      out.errors.push(`Kalshi ${s}: ${(e as Error).message}`);
    }
  }
  return out;
}

// ─── Source tags and final results ──────────────────────────────────────────────────────────────────────────

/**
 * Where an imported market came from, kept in the proposal's private seeding-plan field (only its author and
 * curators can read it), never in public text: `[source polymarket:<slug>]`.
 */
export const sourceTag = (source: ExternalSource, id: string) => `[source ${source}:${id}]`;
export function parseSourceTag(text: string | null | undefined): { source: ExternalSource; id: string } | null {
  const m = /\[source (polymarket|kalshi):([A-Za-z0-9._-]{1,120})\]/.exec(text ?? "");
  return m ? { source: m[1] as ExternalSource, id: m[2]! } : null;
}

export type SourceResult = "yes" | "no" | "pending";

/** A Polymarket market's final result: closed with one outcome priced at 1. Anything else is pending. */
export function polymarketResult(m: Record<string, unknown> | null | undefined): SourceResult {
  if (!m || m.closed !== true) return "pending";
  const status = str(m.umaResolutionStatus);
  if (status && status !== "resolved") return "pending";
  const prices = jsonArray(m.outcomePrices).map(num);
  if (prices[0] === 1 && prices[1] === 0) return "yes";
  if (prices[0] === 0 && prices[1] === 1) return "no";
  return "pending";
}

/** A Kalshi market's final result (`result` once settled). */
export function kalshiResult(m: Record<string, unknown> | null | undefined): SourceResult {
  if (!m || !["settled", "finalized", "determined"].includes(str(m.status))) return "pending";
  const r = str(m.result);
  return r === "yes" || r === "no" ? r : "pending";
}

export async function fetchSourceResult(source: ExternalSource, id: string): Promise<SourceResult> {
  if (source === "polymarket") {
    const body = await getJson(`${POLYMARKET_API}/markets?${new URLSearchParams({ slug: id, closed: "true" })}`, 10_000);
    return polymarketResult((Array.isArray(body) ? body[0] : null) as Record<string, unknown> | null);
  }
  const body = (await getJson(`${KALSHI_API}/markets/${encodeURIComponent(id)}`, 10_000)) as { market?: Record<string, unknown> };
  return kalshiResult(body.market);
}
