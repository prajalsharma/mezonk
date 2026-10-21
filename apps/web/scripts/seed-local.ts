/**
 * Seeds a LOCAL anvil fork with order-book markets in every lifecycle state, via real transactions:
 * seeding, failed seeding (refundable), live with escrowed and signed orders and real fills, closed,
 * proposed, disputed, resolved and invalid.
 * Requires: scripts/dev-chain.sh running, and the app running (evidence docs and signed orders go through the API).
 * Never run against a public network: it refuses unless the RPC is localhost.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTestClient, createWalletClient, erc20Abi, http, parseUnits, publicActions, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { protocolAddresses } from "../src/lib/chain/config";
import { exchangeAbi, factoryAbi, resolutionAbi } from "../src/lib/contracts/abi";
import { serializeMetadata, type MarketMetadata } from "../src/lib/market/metadata";
import { serializeEvidence, type EvidenceDoc } from "../src/lib/market/evidence";
import { exchangeDomain, ORDER_TYPES } from "../src/lib/orderbook/math";
import { ANVIL_CURATOR_PK, signedCreateArgs } from "./lib/approval-sign";

const env = Object.fromEntries(
  readFileSync(path.join(__dirname, "../.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const RPC = env.NEXT_PUBLIC_RPC_URL!;
const P = protocolAddresses(env.NEXT_PUBLIC_MARKETS_ADDRESS as Address);
const EX = P.marketsAddress;
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as Address;
const API = process.env.APP_URL ?? "http://localhost:3000";
if (!/127\.0\.0\.1|localhost/.test(RPC)) throw new Error("seed-local only runs against a localhost RPC");

const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  resolver: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  arbitrator: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  creator: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  alice: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  bob: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  carol: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  curator: ANVIL_CURATOR_PK,
} as const;
type Who = keyof typeof KEYS;
const YES = 0, NO = 1, BUY = 0, SELL = 1;

const chain = { id: 31611, name: "Mezo Testnet (local fork)", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const test = createTestClient({ mode: "anvil", chain, transport: http(RPC) }).extend(publicActions);
const w = (who: Who) => createWalletClient({ account: privateKeyToAccount(KEYS[who]), chain, transport: http(RPC) });
const addr = (who: Who) => privateKeyToAccount(KEYS[who]).address;
const S = (n: number) => parseUnits(String(n), 18); // shares or MUSD

async function send(p: Promise<Hash>) {
  const r = await test.waitForTransactionReceipt({ hash: await p });
  if (r.status !== "success") throw new Error(`tx reverted ${r.transactionHash}`);
  return r;
}
const now = async () => (await test.getBlock()).timestamp;
async function warp(secs: number | bigint) {
  await test.increaseTime({ seconds: Number(secs) });
  await test.mine({ blocks: 1 });
}
const ex = (who: Who, functionName: string, args: readonly unknown[]) =>
  send(w(who).writeContract({ address: EX, abi: exchangeAbi, functionName, args } as never));
const rs = (who: Who, functionName: string, args: readonly unknown[]) =>
  send(w(who).writeContract({ address: P.resolutionAddress, abi: resolutionAbi, functionName, args } as never));

function meta(q: string, category: MarketMetadata["category"], yes: string, no: string, source: [string, string], resolvesAt: bigint): string {
  return serializeMetadata({
    v: 1,
    question: q,
    category,
    description: "Sample market on a local development fork. Not a live market.",
    rules: {
      yes,
      no,
      invalid: "The named source does not publish the figure for the stated date, or publishes it more than 7 days late.",
      ambiguity: "If the source revises the figure, the first published value at the evaluation time counts.",
    },
    source: { name: source[0], url: source[1] },
    resolvesAt: new Date(Number(resolvesAt) * 1000).toISOString(),
  });
}

let policyId = 1;
async function create(metadata: string, closeIn: bigint) {
  const t = await now();
  // Every market goes through a real curator-signed approval bound to the policy, like production.
  const args = await signedCreateArgs(ANVIL_CURATOR_PK, 31611, P.factoryAddress, addr("creator"), { metadata, closeTime: t + closeIn, resolver: addr("resolver"), policyId }, t);
  const r = await send(w("creator").writeContract({ address: P.factoryAddress, abi: factoryAbi, functionName: "createMarket", args: args as never }));
  const n = await test.readContract({ address: EX, abi: exchangeAbi, functionName: "marketCount" });
  console.log(`  market #${n} seeding (tx ${r.transactionHash.slice(0, 10)})`);
  return n;
}

/** Escrowed seed orders on both sides from two wallets, then a real graduation. Book: Yes bid `bid`, ask 100−(100−bid−spread). */
async function seedAndLaunch(id: bigint, bid: number, spread = 6, depth = 80) {
  await ex("alice", "placeOrder", [id, YES, BUY, bid, S(depth)]);
  await ex("bob", "placeOrder", [id, NO, BUY, 100 - bid - spread, S(depth)]);
  await ex("bob", "placeOrder", [id, YES, BUY, bid - 1, S(depth / 2)]);
  await ex("alice", "placeOrder", [id, NO, BUY, 100 - bid - spread - 1, S(depth / 2)]);
  await ex("carol", "graduate", [id]);
}

/** Taker buys `qty` of `outcome` against whatever escrowed orders exist (ids passed explicitly, best first). */
async function takeResting(who: Who, id: bigint, outcome: number, side: number, limit: number, qty: number, restingIds: bigint[]) {
  const ZERO = "0x0000000000000000000000000000000000000000" as const;
  const sources = restingIds.map((rid) => ({
    restingId: rid,
    order: { maker: ZERO, taker: ZERO, marketId: 0n, outcome: 0, side: 0, price: 0, quantity: 0n, expiry: 0n, nonce: 0n, salt: 0n },
    signature: "0x" as const,
  }));
  const t = await now();
  await ex(who, "take", [{ marketId: id, outcome, side, limitPrice: limit, quantity: S(qty), minFill: 0n, deadline: t + 600n }, sources]);
}

async function restingIdsOf(id: bigint) {
  const n = await test.readContract({ address: EX, abi: exchangeAbi, functionName: "restingCount" });
  const out: Array<{ id: bigint; outcome: number; side: number; price: number }> = [];
  for (let i = 1n; i <= n; i++) {
    const o = await test.readContract({ address: EX, abi: exchangeAbi, functionName: "getResting", args: [i] });
    if (o.marketId === id && o.remaining > 0n) out.push({ id: i, outcome: o.outcome, side: o.side, price: o.price });
  }
  return out;
}
/** Resting orders a YES buyer can hit (YES asks = NO bids), best (highest NO bid) first. */
async function yesAsks(id: bigint) {
  return (await restingIdsOf(id)).filter((o) => o.outcome === NO && o.side === BUY).sort((a, b) => b.price - a.price).map((o) => o.id);
}
async function yesBids(id: bigint) {
  return (await restingIdsOf(id)).filter((o) => o.outcome === YES && o.side === BUY).sort((a, b) => b.price - a.price).map((o) => o.id);
}

async function postSigned(who: Who, id: bigint, outcome: number, side: number, price: number, qty: number) {
  const account = privateKeyToAccount(KEYS[who]);
  const t = await now();
  const message = {
    maker: account.address,
    taker: "0x0000000000000000000000000000000000000000" as Address,
    marketId: id,
    outcome,
    side,
    price,
    quantity: S(qty),
    expiry: t + 30n * 86400n,
    nonce: 0n,
    salt: BigInt(Math.floor(Math.random() * 2 ** 48)),
  };
  const signature = await account.signTypedData({ domain: exchangeDomain(31611, EX), types: ORDER_TYPES, primaryType: "Order", message });
  const r = await fetch(`${API}/api/orders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...message, marketId: String(id), quantity: String(message.quantity), expiry: String(message.expiry), nonce: "0", salt: String(message.salt), signature }),
  });
  if (!r.ok) throw new Error(`signed order rejected: ${await r.text()}`);
}

async function waitIndexed(id: bigint) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${API}/api/markets/${id}`).catch(() => null);
    if (r?.ok) return;
    await new Promise((s) => setTimeout(s, 1000));
  }
  throw new Error(`market ${id} not indexed — is the app running with INDEXER_MODE=embedded?`);
}

async function evidence(id: bigint, who: Who, kind: EvidenceDoc["kind"], outcome: "yes" | "no" | "invalid", summary: string, url: string) {
  await waitIndexed(id);
  const doc: EvidenceDoc = { v: 1, kind, marketId: Number(id), outcome, summary, links: [{ url, label: "Source page" }], author: addr(who).toLowerCase(), createdAt: new Date().toISOString() };
  const r = await fetch(`${API}/api/evidence-documents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(doc) });
  const j = await r.json();
  if (!r.ok) throw new Error(`evidence publish failed: ${JSON.stringify(j)}`);
  if (j.raw !== serializeEvidence(doc)) throw new Error("server serialization differs from client");
  return { hash: j.hash as Hash, uri: j.uri as string };
}

const OUT = { yes: 1, no: 2, invalid: 3 } as const;
async function propose(id: bigint, o: keyof typeof OUT, summary: string, url: string) {
  const e = await evidence(id, "resolver", "proposal", o, summary, url);
  await rs("resolver", "proposeOutcome", [id, OUT[o], e.hash, e.uri]);
}

async function main() {
  console.log(`seeding local fork ${RPC}, exchange ${EX}`);
  policyId = Number(await test.readContract({ address: EX, abi: exchangeAbi, functionName: "policyCount" }));
  const pol = await test.readContract({ address: EX, abi: exchangeAbi, functionName: "getPolicy", args: [policyId] });
  const cfg = await test.readContract({ address: P.factoryAddress, abi: factoryAbi, functionName: "config" });
  for (const who of Object.keys(KEYS) as Who[]) {
    await send(w(who).writeContract({ address: MUSD, abi: erc20Abi, functionName: "approve", args: [EX, 2n ** 255n] }));
    await send(w(who).writeContract({ address: MUSD, abi: erc20Abi, functionName: "approve", args: [P.resolutionAddress, 2n ** 255n] }));
  }
  const t0 = await now();
  const H = 3600n, D = 86400n;
  const minClose = BigInt(pol.seedingPeriod) + BigInt(cfg.minLiveDuration);
  const short = minClose + 10n * 60n; // closes soon after the earliest allowed time

  console.log("creating markets");
  const failed = await create(meta("Will Mezo announce a MUSD savings rate above 10% before 1 Nov 2026?", "defi", "mezo.org publishes a MUSD savings rate above 10% APR before 1 Nov 2026 00:00 UTC.", "No such rate is published by then.", ["Mezo blog", "https://mezo.org/blog"], t0 + 40n * D), 30n * D);
  await ex("alice", "placeOrder", [failed, YES, BUY, 30, S(20)]); // one-sided: can never launch
  const open = await create(meta("Will BTC close above $150,000 on Coinbase on 31 Dec 2026 (UTC)?", "bitcoin", "The Coinbase BTC-USD daily candle for 31 Dec 2026 UTC closes above 150,000.00 USD.", "That daily candle closes at or below 150,000.00 USD.", ["Coinbase BTC-USD", "https://www.coinbase.com/price/bitcoin"], t0 + 70n * D), 60n * D);
  const awaiting = await create(meta("Will Mezo testnet produce block 9,000,000 before 1 Dec 2026?", "technology", "explorer.test.mezo.org shows block 9,000,000 with a timestamp before 1 Dec 2026 00:00 UTC.", "Block 9,000,000 has a timestamp at or after 1 Dec 2026 00:00 UTC.", ["Mezo testnet explorer", "https://explorer.test.mezo.org"], t0 + short + 3n * D), short + 3n * D);
  const proposed = await create(meta("Will US CPI YoY for October 2026 print at or above 3.0%?", "economics", "The BLS CPI-U all items 12-month change for October 2026 is 3.0% or higher.", "That figure is below 3.0%.", ["BLS CPI release", "https://www.bls.gov/cpi/"], t0 + short + 3n * D), short + 3n * D);
  const disputed = await create(meta("Will ETH/BTC close above 0.040 on Binance on 20 Oct 2026 (UTC)?", "crypto", "Binance ETHBTC daily close for 20 Oct 2026 UTC is above 0.04000.", "That close is at or below 0.04000.", ["Binance ETHBTC", "https://www.binance.com/en/trade/ETH_BTC"], t0 + short), short);
  const resolved = await create(meta("Will MUSD total supply exceed 50M on 15 Oct 2026?", "defi", "The MUSD contract on Mezo mainnet reports totalSupply above 50,000,000 MUSD at 15 Oct 2026 00:00 UTC.", "totalSupply is at or below 50,000,000 MUSD at that time.", ["Mezo explorer, MUSD token", "https://explorer.mezo.org/token/0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"], t0 + short), short);
  const invalid = await create(meta("Will the Mezo hackathon announce at least 10 winners by 30 Sep 2026?", "other", "mezo.org/blog publishes a winners post listing 10 or more winning teams before 30 Sep 2026 23:59 UTC.", "The post lists fewer than 10 winners, or no post appears by then.", ["Mezo blog", "https://mezo.org/blog"], t0 + short), short);

  console.log("seeding and launching");
  for (const [id, bid] of [[open, 34], [awaiting, 47], [proposed, 40], [disputed, 48], [resolved, 58], [invalid, 50]] as const) await seedAndLaunch(id, bid);

  console.log("trading (real fills against escrowed seed orders)");
  await takeResting("carol", open, YES, BUY, 45, 30, await yesAsks(open));
  await takeResting("carol", open, YES, SELL, 30, 10, await yesBids(open)); // sells back some Yes into the bids
  await takeResting("carol", proposed, YES, BUY, 60, 25, await yesAsks(proposed));
  await takeResting("carol", disputed, YES, BUY, 60, 20, await yesAsks(disputed));
  await takeResting("carol", resolved, YES, BUY, 70, 40, await yesAsks(resolved));
  await takeResting("carol", invalid, YES, BUY, 60, 10, await yesAsks(invalid));
  await takeResting("carol", awaiting, NO, BUY, 60, 15, await yesBids(awaiting)); // buys No by matching Yes bids (mints sets)

  console.log("signed orders on the open market (book liquidity that stays in the maker's wallet)");
  await ex("carol", "split", [open, S(50)]);
  await waitIndexed(open);
  await postSigned("carol", open, YES, SELL, 44, 25);
  await postSigned("carol", open, NO, SELL, 70, 25);

  console.log("closing, proposing, challenging");
  await warp(short + 60n);
  await propose(resolved, "yes", "The explorer's token page shows MUSD totalSupply of 54.2M at the evaluation time, above the 50M threshold.", "https://explorer.mezo.org/token/0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186");
  await propose(disputed, "no", "Binance's 20 Oct daily candle for ETHBTC closed at 0.03871, at or below 0.04000.", "https://www.binance.com/en/trade/ETH_BTC");
  const d = await evidence(disputed, "bob", "dispute", "yes", "The proposal used the wrong day's candle. The 20 Oct UTC close was 0.04012, above the threshold.", "https://www.binance.com/en/trade/ETH_BTC");
  await rs("bob", "dispute", [disputed, d.hash, d.uri]);

  await warp(D + 60n);
  await rs("carol", "finalize", [resolved]);
  await ex("carol", "redeem", [resolved]);

  await warp(2n * D + 60n);
  await rs("carol", "finalize", [invalid]);

  await warp(2n * H);
  await propose(proposed, "yes", "BLS reported CPI-U 12-month change of 3.1% for October 2026, at or above 3.0%.", "https://www.bls.gov/cpi/");

  // Created last so its seeding window is still open after the warps above.
  const seeding = await create(meta("Will Bitcoin's hashrate exceed 1,000 EH/s on 1 Mar 2027?", "bitcoin", "mempool.space reports a 7-day average hashrate above 1,000 EH/s on 1 Mar 2027 UTC.", "It reports 1,000 EH/s or less.", ["mempool.space mining", "https://mempool.space/mining"], (await now()) + 140n * D), 120n * D);
  await ex("alice", "placeOrder", [seeding, YES, BUY, 41, S(60)]);
  await ex("bob", "placeOrder", [seeding, NO, BUY, 50, S(30)]);

  console.log(
    `done. markets: failed #${failed}, live #${open}, awaiting #${awaiting}, proposed #${proposed}, disputed #${disputed}, resolved #${resolved}, invalid #${invalid}, seeding #${seeding}`,
  );
  console.log("note: chain time was advanced; the browser clock and chain clock now differ on this fork.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
