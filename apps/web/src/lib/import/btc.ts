/**
 * Turns external Bitcoin markets into MEZONK markets that settle on Mezo's own BTC price (MezonkPriceResolver).
 *
 * Only point-in-time questions qualify: "BTC at or above $X at time T". Mezo's PriceFeed has no history, so the
 * resolver reads the price once, right after close. "Will BTC hit $X by …" (any time before a date), ranges,
 * and "up or down" questions can't be settled that way and are skipped with a reason.
 */
import type { MarketMetadata } from "@/lib/market/metadata";
import { referenceLabel, sourceName, type ExternalMarket } from "./external";

export type Direction = "above" | "below";

export interface BtcRule {
  strike: number; // whole USD
  direction: Direction;
}

export type Classified = { ok: true; rule: BtcRule } | { ok: false; reason: string };

const BTC = /\b(bitcoin|btc)\b/i;
const UP_DOWN = /\bup or down\b/i;
/** "Any time before" (path-dependent) wording, in the question or the rules. */
const TOUCH_TITLE = /\b(reach|reaches|hit|hits|touch|dip to|dips to|all[- ]time high|ath|how high|how low|highest|lowest)\b/i;
const TOUCH_RULES = /\b(at any (time|point)|any time (before|during)|at any moment|final "?(high|low)"? price|(high|low) price (equal|of))\b/i;
const RANGE = /\$?\d[\d,]*(\.\d+)?\s*k?\s*(-|–|to)\s*\$?\d[\d,]*(\.\d+)?\s*k?\b|\bbetween\b|\brange\b/i;
const ABOVE = /\b(above|over|higher than|greater than|at least|or more|or above|or higher)\b/i;
const BELOW = /\b(below|under|lower than|less than|or less|or below|or lower)\b/i;

/** Dollar amounts like $120,000 / $120k / 120,000 (the last only in short labels). */
function amounts(text: string, requireDollar: boolean): number[] {
  const re = requireDollar ? /\$\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?\b/gi : /\$?\s?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(k)?\b/gi;
  const out: number[] = [];
  for (const m of text.matchAll(re)) {
    const n = Number(m[1]!.replace(/,/g, "")) * (m[2] ? 1000 : 1);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

const plausible = (n: number) => n >= 1_000 && n <= 10_000_000;

export function classify(m: ExternalMarket): Classified {
  const text = `${m.title} ${m.label}`;
  if (!BTC.test(text) && !BTC.test(m.rules.slice(0, 300))) return { ok: false, reason: "not about the Bitcoin price" };
  if (UP_DOWN.test(text)) return { ok: false, reason: "up-or-down question (that's the BTC up/down rounds)" };
  if (TOUCH_TITLE.test(text) || TOUCH_RULES.test(m.rules)) return { ok: false, reason: "any-time-before question; Mezo's feed can only be read at one moment" };

  // Kalshi gives the strike as data; prefer it to parsing words.
  if (m.strike?.type) {
    const t = m.strike.type;
    if ((t === "greater" || t === "greater_or_equal") && m.strike.floor != null && plausible(m.strike.floor)) return { ok: true, rule: { strike: Math.round(m.strike.floor), direction: "above" } };
    if ((t === "less" || t === "less_or_equal") && m.strike.cap != null && plausible(m.strike.cap)) return { ok: true, rule: { strike: Math.round(m.strike.cap), direction: "below" } };
    return { ok: false, reason: `strike type "${t}" isn't a single above/below level` };
  }

  if (RANGE.test(text)) return { ok: false, reason: "price range, not a single level" };
  const above = ABOVE.test(text), below = BELOW.test(text);
  if (above === below) return { ok: false, reason: above ? "says both above and below" : "no above/below wording" };
  const found = [...new Set([...amounts(m.title, true), ...amounts(m.label, false)].filter(plausible))];
  if (found.length !== 1) return { ok: false, reason: found.length ? "more than one price level" : "no price level" };
  return { ok: true, rule: { strike: Math.round(found[0]!), direction: above ? "above" : "below" } };
}

export interface Candidate {
  market: ExternalMarket;
  rule: BtcRule;
  probYes: number;
}

export interface SelectOptions {
  /** Earliest and latest acceptable close (= evaluation) time. */
  minClose: Date;
  maxClose: Date;
  limit: number;
  /** At most this many markets measured at the same moment (so one date doesn't take every slot). */
  perMoment: number;
  /** Skip near-certain questions: they don't trade. */
  minProb: number;
  maxProb: number;
  /** Questions already on MEZONK (exact text), skipped. */
  existingQuestions?: Set<string>;
}

export interface Selection {
  picked: Candidate[];
  skipped: Array<{ market: ExternalMarket; reason: string }>;
}

/** Classify, filter, de-duplicate (same moment + strike across sources) and rank by 24h volume. */
export function select(markets: ExternalMarket[], o: SelectOptions, captureMinutes = 15): Selection {
  const skipped: Selection["skipped"] = [];
  const best = new Map<string, Candidate>();
  for (const m of markets) {
    const c = classify(m);
    if (!c.ok) { skipped.push({ market: m, reason: c.reason }); continue; }
    if (m.evaluatesAt < o.minClose) { skipped.push({ market: m, reason: "measured too soon to seed and trade first" }); continue; }
    if (m.evaluatesAt > o.maxClose) { skipped.push({ market: m, reason: "measured too far out for this month's batch" }); continue; }
    if (m.probYes == null) { skipped.push({ market: m, reason: "no usable price on the source" }); continue; }
    if (m.probYes < o.minProb || m.probYes > o.maxProb) { skipped.push({ market: m, reason: `Yes at ${Math.round(m.probYes * 100)}%, too one-sided` }); continue; }
    const q = buildMetadata({ market: m, rule: c.rule, probYes: m.probYes }, captureMinutes).question;
    if (o.existingQuestions?.has(q)) { skipped.push({ market: m, reason: "already on MEZONK" }); continue; }
    // "Above X" and "below X" at the same moment are one question.
    const key = `${Math.floor(m.evaluatesAt.getTime() / 60_000)}|${c.rule.strike}`;
    const prev = best.get(key);
    const cand = { market: m, rule: c.rule, probYes: m.probYes };
    if (!prev || m.volume24h > prev.market.volume24h) {
      if (prev) skipped.push({ market: prev.market, reason: "same question with more volume elsewhere" });
      best.set(key, cand);
    } else skipped.push({ market: m, reason: "same question with more volume elsewhere" });
  }
  const ranked = [...best.values()].sort((a, b) => b.market.volume24h - a.market.volume24h);
  const picked: Candidate[] = [];
  const perMoment = new Map<number, number>();
  for (const c of ranked) {
    const t = c.market.evaluatesAt.getTime();
    if (picked.length >= o.limit) { skipped.push({ market: c.market, reason: "ranked below this run's limit" }); continue; }
    if ((perMoment.get(t) ?? 0) >= o.perMoment) { skipped.push({ market: c.market, reason: "enough markets for that date already" }); continue; }
    perMoment.set(t, (perMoment.get(t) ?? 0) + 1);
    picked.push(c);
  }
  return { picked, skipped };
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "17:00 UTC, Nov 30, 2026". Always UTC so the text is the same for everyone. */
export function utcMoment(d: Date): string {
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} UTC, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

export const MEZO_PRICE_FEED_URL = "https://explorer.test.mezo.org/address/0x86bCF0841622a5dAC14A313a15f96A95421b9366";

/** The MEZONK market for a candidate. Close time = the source's measurement time = when Mezo's price is read. */
export function buildMetadata(c: Candidate, captureMinutes: number, priceFeedUrl = MEZO_PRICE_FEED_URL): MarketMetadata {
  const { strike, direction } = c.rule;
  const when = utcMoment(c.market.evaluatesAt);
  const src = sourceName[c.market.source];
  const level = direction === "above" ? `at or above ${usd(strike)}` : `below ${usd(strike)}`;
  const theirs = c.market.title.length > 140 ? `${c.market.title.slice(0, 137)}…` : c.market.title;
  return {
    v: 1,
    question: `Will Bitcoin be ${level} on Mezo's price feed at ${when}?`,
    category: "bitcoin",
    description:
      `The same question as ${src}'s "${theirs}", settled on Mezo's own BTC/USD price: the price Mezo uses for loans and liquidations. ` +
      `Trading closes at ${when}, and the price is read right after. Mezo's price and the exchange price ${src} uses can differ by a few dollars, ` +
      `so if Bitcoin ends very close to ${usd(strike)} the two markets can resolve differently.`,
    rules: {
      yes:
        direction === "above"
          ? `MEZONK's price resolver reads Mezo's BTC/USD PriceFeed within ${captureMinutes} minutes after ${when}, and the price is ${usd(strike)} or higher.`
          : `MEZONK's price resolver reads Mezo's BTC/USD PriceFeed within ${captureMinutes} minutes after ${when}, and the price is lower than ${usd(strike)}.`,
      no: direction === "above" ? `That reading is lower than ${usd(strike)}.` : `That reading is ${usd(strike)} or higher.`,
      invalid: `Mezo's PriceFeed publishes no BTC/USD price update in the 24 hours after ${when}, or the feed is discontinued before then.`,
      ambiguity:
        `Only Mezo's PriceFeed counts; ${src}'s result does not decide this market. If the automatic reading is missed, the resolver proposes the ` +
        `first PriceFeed update after the close, with evidence, and anyone can challenge it.`,
    },
    source: { name: "Mezo PriceFeed (BTC/USD)", url: priceFeedUrl },
    resolvesAt: c.market.evaluatesAt.toISOString(),
  };
}

/** Off-chain proposal fields (not hashed into the rules). */
export function buildProposalExtras(c: Candidate, importedAt: Date) {
  const src = sourceName[c.market.source];
  const vol = c.market.source === "polymarket" ? `${usd(c.market.volume24h)} traded in 24h` : `${Math.round(c.market.volume24h).toLocaleString("en-US")} contracts traded in 24h`;
  return {
    summary: `One of the most traded Bitcoin price questions on ${src}, brought to Mezo.`,
    rationale:
      `Imported automatically on ${importedAt.toISOString().slice(0, 10)}: one of the most traded Bitcoin price questions on ${src} (${vol}). ` +
      `It asks about the price at one moment, so Mezo's PriceFeed can settle it without a person deciding.`,
    references: [{ url: c.market.url, label: referenceLabel(c.market.source, c.market.id).slice(0, 80) }],
    liquidityPlan: `The importer seeds both sides around ${src}'s price at import time (Yes ≈ ${Math.round(c.probYes * 100)}¢).`,
    conflicts: "None. Imported by the MEZONK importer; the importing wallets hold no position on the source market.",
  };
}

export interface SeedPlan {
  /** YES bid price in cents. */
  yesBid: number;
  /** NO bid price in cents (= a YES ask at 100 − noBid). */
  noBid: number;
  /** Shares per side, whole shares. */
  shares: number;
}

/**
 * Seed both sides around the source's probability, inside the policy's spread, with at least the policy's depth
 * and enough escrow to count as a seeder. Prices are whole cents.
 */
export function seedPlan(probYes: number, policy: { minBidDepth: number; minAskDepth: number; maxSpread: number; minSeederNotional: number }, spread = 6): SeedPlan {
  const s = Math.max(2, Math.min(spread, policy.maxSpread));
  const p = Math.round(probYes * 100);
  const yesBid = Math.min(Math.max(p - Math.floor(s / 2), 1), 99 - s);
  const yesAsk = yesBid + s;
  const noBid = 100 - yesAsk;
  let shares = Math.max(policy.minBidDepth, policy.minAskDepth, 1);
  // Escrow = shares × (yesBid + noBid) / 100 MUSD; raise shares until it meets the seeder minimum.
  const perShare = (yesBid + noBid) / 100;
  if (shares * perShare < policy.minSeederNotional) shares = Math.ceil(policy.minSeederNotional / perShare);
  return { yesBid, noBid, shares };
}
