import { describe, expect, it } from "vitest";
import { buildMetadata, classify, seedPlan, select, type SelectOptions } from "@/lib/import/btc";
import { parseKalshiMarkets, parsePolymarketEvents, parseReferenceLabel, type ExternalMarket } from "@/lib/import/external";
import { metadataSchema, reviewMetadata } from "@/lib/market/metadata";

// Fixtures follow each API's documented shape. Gamma encodes outcomes/outcomePrices as JSON strings.
const polyEvents = [
  {
    title: "Bitcoin above ___ on November 30?",
    slug: "bitcoin-above-on-november-30",
    endDate: "2026-11-30T17:00:00Z",
    markets: [
      {
        question: "Will the price of Bitcoin be above $120,000 on November 30?",
        slug: "bitcoin-above-120k-on-november-30",
        groupItemTitle: "120,000",
        endDate: "2026-11-30T17:00:00Z",
        outcomes: '["Yes", "No"]',
        outcomePrices: '["0.41", "0.59"]',
        bestBid: 0.4,
        bestAsk: 0.42,
        volume24hr: 250000,
        active: true,
        closed: false,
        description: 'Resolves Yes if the Binance 1 minute candle for BTC/USDT 12:00 ET on the date in the title has a final "Close" price higher than the price in the title.',
      },
      {
        question: "Will the price of Bitcoin be above $150,000 on November 30?",
        slug: "bitcoin-above-150k-on-november-30",
        groupItemTitle: "150,000",
        endDate: "2026-11-30T17:00:00Z",
        outcomes: '["Yes", "No"]',
        outcomePrices: '["0.02", "0.98"]',
        volume24hr: 90000,
        active: true,
        closed: false,
        description: "Same rules.",
      },
    ],
  },
  {
    title: "What price will Bitcoin hit in November?",
    slug: "what-price-will-bitcoin-hit-in-november",
    endDate: "2026-12-01T05:00:00Z",
    markets: [
      {
        question: "Will Bitcoin reach $130,000 in November?",
        slug: "will-bitcoin-reach-130k-in-november",
        groupItemTitle: "↑ 130,000",
        endDate: "2026-12-01T05:00:00Z",
        outcomes: '["Yes", "No"]',
        outcomePrices: '["0.3", "0.7"]',
        volume24hr: 900000,
        active: true,
        closed: false,
        description: 'Resolves Yes if any Binance 1 minute candle has a final "High" price equal to or greater than the price.',
      },
    ],
  },
  {
    title: "Bitcoin Up or Down on November 7?",
    slug: "bitcoin-up-or-down-november-7",
    endDate: "2026-11-07T17:00:00Z",
    markets: [{ question: "Bitcoin Up or Down on November 7?", slug: "btc-updown-nov-7", endDate: "2026-11-07T17:00:00Z", outcomes: '["Up", "Down"]', outcomePrices: '["0.5","0.5"]', volume24hr: 5e6, active: true, closed: false }],
  },
];

const kalshi = {
  markets: [
    {
      ticker: "KXBTCD-26NOV3017-T119999.99",
      event_ticker: "KXBTCD-26NOV3017",
      market_type: "binary",
      title: "Bitcoin price on Nov 30, 2026 at 5pm EST?",
      yes_sub_title: "$120,000 or above",
      status: "active",
      close_time: "2026-11-30T22:00:00Z",
      strike_type: "greater",
      floor_strike: 119999.99,
      yes_bid_dollars: "0.3800",
      yes_ask_dollars: "0.4100",
      last_price_dollars: "0.3900",
      volume_24h: 40000,
      rules_primary: "If the average of CF Benchmarks' BRTI in the 60 seconds before 5 PM EST on Nov 30, 2026 is above 119999.99, then the market resolves to Yes.",
    },
    {
      ticker: "KXBTC-26NOV3017-B121250",
      event_ticker: "KXBTC-26NOV3017",
      market_type: "binary",
      title: "Bitcoin price range on Nov 30, 2026?",
      yes_sub_title: "$121,000 to 121,499.99",
      status: "active",
      close_time: "2026-11-30T22:00:00Z",
      strike_type: "between",
      floor_strike: 121000,
      cap_strike: 121499.99,
      yes_bid: 5,
      yes_ask: 7,
      volume_24h: 8000,
      rules_primary: "If the price is between…",
    },
    {
      ticker: "KXBTCMAXY-26DEC31-149999.99",
      event_ticker: "KXBTCMAXY-26DEC31",
      title: "How high will Bitcoin get this year?",
      yes_sub_title: "Above $150,000",
      status: "active",
      close_time: "2026-12-31T23:59:00Z",
      strike_type: "greater",
      floor_strike: 149999.99,
      yes_bid: 10,
      yes_ask: 12,
      volume_24h: 12000,
      rules_primary: "If the BRTI is above 149999.99 at any time before Dec 31, 2026, the market resolves to Yes.",
    },
  ],
};

const opts = (over: Partial<SelectOptions> = {}): SelectOptions => ({
  minClose: new Date("2026-11-10T00:00:00Z"),
  maxClose: new Date("2026-12-20T00:00:00Z"),
  limit: 4,
  perMoment: 2,
  minProb: 0.1,
  maxProb: 0.9,
  ...over,
});

describe("external market parsers", () => {
  it("parses Gamma events, keeps only Yes/No markets and decodes string arrays", () => {
    const { markets, skipped } = parsePolymarketEvents(polyEvents);
    expect(markets.map((m) => m.id)).toEqual(["bitcoin-above-120k-on-november-30", "bitcoin-above-150k-on-november-30", "will-bitcoin-reach-130k-in-november"]);
    expect(skipped.find((s) => s.id === "btc-updown-nov-7")?.reason).toBe("not a Yes/No market");
    expect(markets[0]!.probYes).toBeCloseTo(0.41); // tight book midpoint
    expect(markets[1]!.probYes).toBeCloseTo(0.02); // no book: display price
    expect(markets[0]!.url).toBe("https://polymarket.com/event/bitcoin-above-on-november-30");
  });

  it("parses Kalshi markets with dollar strings or integer cents", () => {
    const { markets } = parseKalshiMarkets(kalshi);
    expect(markets).toHaveLength(3);
    expect(markets[0]!.probYes).toBeCloseTo(0.395);
    expect(markets[1]!.probYes).toBeCloseTo(0.06);
    expect(markets[0]!.url).toBe("https://kalshi.com/markets/kxbtcd");
  });

  it("drops malformed input instead of guessing", () => {
    expect(parsePolymarketEvents({}).markets).toEqual([]);
    expect(parseKalshiMarkets(null).markets).toEqual([]);
    expect(parsePolymarketEvents([{ markets: [{ slug: "x", question: "Bitcoin above $100,000?", outcomes: '["Yes","No"]' }] }]).skipped[0]?.reason).toBe("no end date");
  });

  it("reads reference labels strictly", () => {
    expect(parseReferenceLabel("kalshi:KXBTCD-26NOV3017-T119999.99")).toEqual({ source: "kalshi", id: "KXBTCD-26NOV3017-T119999.99" });
    expect(parseReferenceLabel("polymarket:bitcoin-above-120k")).toEqual({ source: "polymarket", id: "bitcoin-above-120k" });
    expect(parseReferenceLabel("polymarket:../../etc")).toBeNull();
    expect(parseReferenceLabel("Coinbase")).toBeNull();
  });
});

describe("classify", () => {
  const poly = parsePolymarketEvents(polyEvents).markets;
  const k = parseKalshiMarkets(kalshi).markets;
  it("accepts point-in-time above/below questions", () => {
    expect(classify(poly[0]!)).toEqual({ ok: true, rule: { strike: 120000, direction: "above" } });
    expect(classify(k[0]!)).toEqual({ ok: true, rule: { strike: 120000, direction: "above" } });
  });
  it("rejects any-time-before, range and up/down questions", () => {
    expect(classify(poly[2]!).ok).toBe(false);
    expect(classify(k[1]!)).toMatchObject({ ok: false, reason: expect.stringContaining("between") });
    expect(classify(k[2]!)).toMatchObject({ ok: false, reason: expect.stringContaining("any-time") });
  });
  it("needs exactly one price level and one direction", () => {
    const base: ExternalMarket = { source: "polymarket", id: "x", url: "https://x", title: "", label: "", rules: "", evaluatesAt: new Date(), probYes: 0.5, volume24h: 1 };
    expect(classify({ ...base, title: "Will Bitcoin be below $90k on Dec 1?" })).toEqual({ ok: true, rule: { strike: 90000, direction: "below" } });
    expect(classify({ ...base, title: "Will Bitcoin be above $90,000 or $95,000?" }).ok).toBe(false);
    expect(classify({ ...base, title: "Will Bitcoin close the year strong?" }).ok).toBe(false);
    expect(classify({ ...base, title: "Will Ethereum be above $5,000?" }).ok).toBe(false);
  });
});

describe("select", () => {
  const all = [...parsePolymarketEvents(polyEvents).markets, ...parseKalshiMarkets(kalshi).markets];
  it("ranks by volume, drops one-sided and duplicate questions", () => {
    const s = select(all, opts());
    // Polymarket $120k at 17:00 and Kalshi $120k at 22:00 are different moments: both kept.
    expect(s.picked.map((c) => c.market.id)).toEqual(["bitcoin-above-120k-on-november-30", "KXBTCD-26NOV3017-T119999.99"]);
    expect(s.skipped.find((x) => x.market.id === "bitcoin-above-150k-on-november-30")?.reason).toMatch(/one-sided/);
  });
  it("respects the close window, limit and existing questions", () => {
    expect(select(all, opts({ minClose: new Date("2026-12-01T00:00:00Z") })).picked).toEqual([]);
    expect(select(all, opts({ limit: 1 })).picked).toHaveLength(1);
    const q = buildMetadata(select(all, opts()).picked[0]!, 15).question;
    expect(select(all, opts({ existingQuestions: new Set([q]) })).picked.map((c) => c.market.source)).toEqual(["kalshi"]);
  });
  it("treats the same moment and strike on two sources as one question, keeping the busier", () => {
    const twin: ExternalMarket = { ...parseKalshiMarkets(kalshi).markets[0]!, evaluatesAt: new Date("2026-11-30T17:00:00Z"), volume24h: 1e9 };
    const s = select([...all, twin], opts());
    expect(s.picked[0]!.market.source).toBe("kalshi");
    expect(s.picked.filter((c) => c.rule.strike === 120000 && c.market.evaluatesAt.getUTCHours() === 17)).toHaveLength(1);
  });
});

describe("buildMetadata", () => {
  const c = select(parsePolymarketEvents(polyEvents).markets, opts()).picked[0]!;
  const m = buildMetadata(c, 15);
  it("produces valid, review-clean MEZONK rules settled on Mezo's feed", () => {
    expect(metadataSchema.safeParse(m).success).toBe(true);
    expect(reviewMetadata(m, new Date(m.resolvesAt)).filter((i) => i.blocking)).toEqual([]);
    expect(m.question).toBe("Will Bitcoin be at or above $120,000 on Mezo's price feed at 17:00 UTC, Nov 30, 2026?");
    expect(m.rules.yes).toContain("$120,000 or higher");
    expect(m.resolvesAt).toBe("2026-11-30T17:00:00.000Z");
    expect(m.description).toContain("Polymarket");
  });
});

describe("seedPlan", () => {
  const fast = { minBidDepth: 20, minAskDepth: 20, maxSpread: 10, minSeederNotional: 10 };
  it("quotes both sides around the source price within the spread", () => {
    expect(seedPlan(0.41, fast)).toEqual({ yesBid: 38, noBid: 56, shares: 20 }); // YES ask = 44
  });
  it("stays inside 1–99 at the extremes", () => {
    const lo = seedPlan(0.01, fast), hi = seedPlan(0.99, fast);
    expect(lo.yesBid).toBe(1);
    expect(100 - lo.noBid - lo.yesBid).toBe(6);
    expect(hi.noBid).toBe(1);
  });
  it("raises size until the escrow counts as a seeder", () => {
    const p = seedPlan(0.5, { ...fast, minBidDepth: 1, minAskDepth: 1, minSeederNotional: 30 });
    expect(p.shares * (p.yesBid + p.noBid)).toBeGreaterThanOrEqual(3000);
  });
});
