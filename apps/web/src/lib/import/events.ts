/**
 * The monthly picks beyond Bitcoin: each month, two questions chosen at random from the most traded open questions
 * elsewhere, rewritten as standalone MEZONK rules. Unlike the Bitcoin markets these can't settle from a price feed:
 * an allowlisted resolver proposes the outcome with evidence from the named official source, and it can be
 * challenged like any market.
 *
 * Public text never names where a question was found. A question qualifies only if its rules can be rewritten
 * cleanly: a "Yes if …" condition, an official https source that isn't another prediction market, and no wording that
 * only makes sense on the original site.
 */
import type { Category, MarketMetadata } from "@/lib/market/metadata";
import { metadataSchema, reviewMetadata } from "@/lib/market/metadata";
import { utcMoment } from "./btc";
import { sourceTag, type ExternalMarket } from "./external";

/** Never imported: crypto (Bitcoin has its own monthly markets; other coins aren't MEZONK's focus). */
const CRYPTO = /\b(bitcoin|btc|ethereum|eth|crypto|cryptocurrency|solana|sol|xrp|doge|dogecoin|memecoin|token|airdrop|stablecoin|altcoin|fdv|tvl)\b/i;
const CRYPTO_TAGS = new Set(["crypto", "bitcoin", "ethereum", "solana", "crypto-prices", "xrp", "memecoins", "airdrops", "defi", "nft"]);
/** Wording tied to the original site or its dispute process. Sentences containing it are dropped. */
const SITE_WORDS = /\b(polymarket|kalshi|uma|clarification|market maker|this market (will|may) remain|may be resolved early|resolution committee|50-50|50\/50)\b/i;
const OTHER_MARKETS = /(^|\.)(polymarket\.com|kalshi\.com|manifold\.markets|predictit\.org|metaculus\.com)$/i;

export type EventClassified = { ok: true; metadata: MarketMetadata } | { ok: false; reason: string };

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z"“(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Up to `max` characters of whole sentences. */
function upTo(parts: string[], max: number): string {
  let out = "";
  for (const p of parts) {
    if ((out ? out.length + 1 : 0) + p.length > max) break;
    out = out ? `${out} ${p}` : p;
  }
  return out;
}

function categoryOf(tags: string[]): Category {
  const has = (...xs: string[]) => xs.some((x) => tags.includes(x));
  if (has("sports", "nba", "nfl", "soccer", "football", "mlb", "nhl", "tennis", "f1", "ufc", "golf", "cricket", "esports")) return "sports";
  if (has("economy", "economics", "fed", "fed-rates", "inflation", "finance", "business", "stocks", "earnings", "macro")) return "economics";
  if (has("tech", "technology", "ai", "science", "space", "openai", "apple", "google")) return "technology";
  return "other";
}

/** Rewrites one external question as MEZONK rules, or says why it can't be. */
export function classifyEvent(m: ExternalMarket): EventClassified {
  if (m.source !== "polymarket") return { ok: false, reason: "only sources that name an official resolution source" };
  if (CRYPTO.test(`${m.title} ${m.label}`) || (m.tags ?? []).some((t) => CRYPTO_TAGS.has(t))) return { ok: false, reason: "crypto question" };
  let host: string;
  try {
    const u = new URL(m.resolutionSource ?? "");
    if (u.protocol !== "https:") throw new Error();
    host = u.hostname.replace(/^www\./, "");
  } catch {
    return { ok: false, reason: "no official https source" };
  }
  if (OTHER_MARKETS.test(host)) return { ok: false, reason: "resolves on another prediction market" };

  const all = sentences(m.rules);
  const yesIdx = all.findIndex((s) => /resolve(s|d)?\s+(to|as)\s+["“]?yes["”]?\s+if\b/i.test(s));
  if (yesIdx < 0) return { ok: false, reason: "no \"Yes if\" condition in its rules" };
  const cond = all[yesIdx]!.replace(/^.*?resolve(s|d)?\s+(to|as)\s+["“]?yes["”]?\s+if\s+/i, "").replace(/[.\s]+$/, "");
  if (SITE_WORDS.test(cond) || cond.length < 12) return { ok: false, reason: "its Yes condition depends on the original site" };
  const rest = all
    .filter((_, i) => i !== yesIdx)
    .filter((s) => !/resolve(s|d)?\s+(to|as)\s+["“]?no["”]?/i.test(s) && !SITE_WORDS.test(s))
    .map((s) => s.replace(/\bthis market\b/gi, "this question"));

  const when = utcMoment(m.evaluatesAt);
  const grace = utcMoment(new Date(m.evaluatesAt.getTime() + 7 * 86_400_000));
  const question = m.title.trim();
  const metadata: MarketMetadata = {
    v: 1,
    question,
    category: categoryOf(m.tags ?? []),
    description: "One of this month's two MEZONK picks beyond Bitcoin, chosen from the most traded questions right now.",
    rules: {
      yes: `Yes if ${cond}.`.slice(0, 600),
      no: `No if that hasn't happened when trading closes at ${when}, according to ${host}.`,
      invalid: `${host} publishes no result for this question by ${grace}, or the event is cancelled without a result.`,
      ambiguity: upTo(rest, 600),
    },
    source: { name: host.slice(0, 80), url: m.resolutionSource! },
    resolvesAt: m.evaluatesAt.toISOString(),
  };
  if (!metadataSchema.safeParse(metadata).success) return { ok: false, reason: "doesn't fit MEZONK's rules format (length)" };
  const blocking = reviewMetadata(metadata, m.evaluatesAt).filter((i) => i.blocking);
  if (blocking.length) return { ok: false, reason: `fails review: ${blocking[0]!.message}` };
  if (/polymarket|kalshi/i.test(JSON.stringify(metadata))) return { ok: false, reason: "still mentions the original site" };
  return { ok: true, metadata };
}

export interface EventCandidate {
  market: ExternalMarket;
  metadata: MarketMetadata;
  probYes: number;
}

export interface EventSelectOptions {
  minClose: Date;
  maxClose: Date;
  count: number;
  /** Draw from this many of the most traded qualifying questions. */
  pool: number;
  minProb: number;
  maxProb: number;
  existingQuestions?: Set<string>;
  /** Random integer in [0, n). Injected so tests are deterministic. */
  randomInt: (n: number) => number;
}

/** Picks `count` qualifying questions at random from the `pool` most traded, at most one per event. */
export function selectEvents(markets: ExternalMarket[], o: EventSelectOptions) {
  const skipped: Array<{ market: ExternalMarket; reason: string }> = [];
  const ok: EventCandidate[] = [];
  for (const m of markets) {
    if (m.evaluatesAt < o.minClose) { skipped.push({ market: m, reason: "ends too soon to seed and trade first" }); continue; }
    if (m.evaluatesAt > o.maxClose) { skipped.push({ market: m, reason: "ends too far out" }); continue; }
    if (m.probYes == null || m.probYes < o.minProb || m.probYes > o.maxProb) { skipped.push({ market: m, reason: "too one-sided or no price" }); continue; }
    const c = classifyEvent(m);
    if (!c.ok) { skipped.push({ market: m, reason: c.reason }); continue; }
    if (o.existingQuestions?.has(c.metadata.question)) { skipped.push({ market: m, reason: "already on MEZONK" }); continue; }
    ok.push({ market: m, metadata: c.metadata, probYes: m.probYes });
  }
  // One per event (a multi-question event would otherwise crowd out the rest), the busiest question of each.
  const perEvent = new Map<string, EventCandidate>();
  for (const c of ok.sort((a, b) => b.market.volume24h - a.market.volume24h)) {
    const k = c.market.eventId ?? c.market.id;
    if (!perEvent.has(k)) perEvent.set(k, c);
  }
  const pool = [...perEvent.values()].slice(0, o.pool);
  const picked: EventCandidate[] = [];
  while (picked.length < o.count && pool.length) picked.push(pool.splice(o.randomInt(pool.length), 1)[0]!);
  return { picked, skipped, poolSize: perEvent.size };
}

export function eventProposalExtras(c: EventCandidate, importedAt: Date) {
  return {
    summary: "One of this month's two picks beyond Bitcoin.",
    rationale:
      `Picked at random on ${importedAt.toISOString().slice(0, 10)} from the most traded open questions right now. Its rules name an official ` +
      `source (${c.metadata.source.name}), and the resolver proposes the outcome from it with evidence after trading closes.`,
    references: [{ url: c.metadata.source.url, label: c.metadata.source.name }],
    liquidityPlan: `Seeded automatically on both sides around Yes ≈ ${Math.round(c.probYes * 100)}¢. ${sourceTag(c.market.source, c.market.id)}`,
    conflicts: "None. Listed by MEZONK's monthly market wallets, which hold no position on this question elsewhere.",
  };
}
