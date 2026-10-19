/**
 * Seeds a LOCAL anvil fork with sample markets in every lifecycle state, via real transactions.
 * Requires: scripts/dev-chain.sh running, and `pnpm dev` running (evidence docs are published through the API).
 * Never run against a public network: it refuses unless the RPC is localhost.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTestClient, createWalletClient, erc20Abi, http, parseUnits, publicActions, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezonkMarketsAbi } from "../src/lib/contracts/abi";
import { serializeMetadata, type MarketMetadata } from "../src/lib/market/metadata";
import { serializeEvidence, type EvidenceDoc } from "../src/lib/market/evidence";

const env = Object.fromEntries(
  readFileSync(path.join(__dirname, "../.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
const RPC = env.NEXT_PUBLIC_RPC_URL!;
const MARKETS = env.NEXT_PUBLIC_MARKETS_ADDRESS as Address;
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
} as const;
type Who = keyof typeof KEYS;

const chain = { id: 31611, name: "Mezo Testnet (local fork)", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
const test = createTestClient({ mode: "anvil", chain, transport: http(RPC) }).extend(publicActions);
const w = (who: Who) => createWalletClient({ account: privateKeyToAccount(KEYS[who]), chain, transport: http(RPC) });
const addr = (who: Who) => privateKeyToAccount(KEYS[who]).address;
const M = (n: number) => parseUnits(String(n), 18);

async function send(p: Promise<Hash>) {
  const r = await test.waitForTransactionReceipt({ hash: await p });
  if (r.status !== "success") throw new Error(`tx reverted ${r.transactionHash}`);
  return r;
}
const now = async () => (await test.getBlock()).timestamp;
async function warp(secs: number) {
  await test.increaseTime({ seconds: secs });
  await test.mine({ blocks: 1 });
}

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

async function create(metadata: string, closeIn: bigint, liq: number, prob: number) {
  const t = await now();
  const r = await send(
    w("creator").writeContract({
      address: MARKETS,
      abi: mezonkMarketsAbi,
      functionName: "createMarket",
      args: [{ metadata, closeTime: t + closeIn, resolver: addr("resolver"), initialLiquidity: M(liq), initialYesProbBps: prob }],
    }),
  );
  const n = await test.readContract({ address: MARKETS, abi: mezonkMarketsAbi, functionName: "marketCount" });
  console.log(`  market #${n} (tx ${r.transactionHash.slice(0, 10)})`);
  return n;
}

const trade = (who: Who, id: bigint, yes: boolean, amt: number) =>
  send(w(who).writeContract({ address: MARKETS, abi: mezonkMarketsAbi, functionName: "buy", args: [id, yes, M(amt), 0n, (2n ** 63n)] }));

async function waitIndexed(id: bigint) {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${API}/api/markets/${id}`).catch(() => null);
    if (r?.ok) return;
    await new Promise((s) => setTimeout(s, 1000));
  }
  throw new Error(`market ${id} not indexed — is pnpm dev running with INDEXER_MODE=embedded?`);
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
  await send(w("resolver").writeContract({ address: MARKETS, abi: mezonkMarketsAbi, functionName: "proposeOutcome", args: [id, OUT[o], e.hash, e.uri] }));
}

async function main() {
  console.log(`seeding local fork ${RPC}, contract ${MARKETS}`);
  for (const who of Object.keys(KEYS) as Who[]) {
    await send(w(who).writeContract({ address: MUSD, abi: erc20Abi, functionName: "approve", args: [MARKETS, 2n ** 255n] }));
  }
  const t0 = await now();
  const H = 3600n, D = 86400n;

  console.log("creating markets");
  const open = await create(meta("Will BTC close above $150,000 on Coinbase on 31 Dec 2026 (UTC)?", "bitcoin", "The Coinbase BTC-USD daily candle for 31 Dec 2026 UTC closes above 150,000.00 USD.", "That daily candle closes at or below 150,000.00 USD.", ["Coinbase BTC-USD", "https://www.coinbase.com/price/bitcoin"], t0 + 70n * D), 60n * D, 1000, 3500);
  const awaiting = await create(meta("Will Mezo testnet produce block 9,000,000 before 1 Dec 2026?", "technology", "explorer.test.mezo.org shows block 9,000,000 with a timestamp before 1 Dec 2026 00:00 UTC.", "Block 9,000,000 has a timestamp at or after 1 Dec 2026 00:00 UTC.", ["Mezo testnet explorer", "https://explorer.test.mezo.org"], t0 + 3n * D + 3n * H), 3n * D + 3n * H, 200, 5000);
  const proposed = await create(meta("Will US CPI YoY for October 2026 print at or above 3.0%?", "economics", "The BLS CPI-U all items 12-month change for October 2026 is 3.0% or higher.", "That figure is below 3.0%.", ["BLS CPI release", "https://www.bls.gov/cpi/"], t0 + 3n * D + 3n * H), 3n * D + 3n * H, 300, 4200);
  const disputed = await create(meta("Will ETH/BTC close above 0.040 on Binance on 20 Oct 2026 (UTC)?", "crypto", "Binance ETHBTC daily close for 20 Oct 2026 UTC is above 0.04000.", "That close is at or below 0.04000.", ["Binance ETHBTC", "https://www.binance.com/en/trade/ETH_BTC"], t0 + 2n * H), 2n * H, 150, 5000);
  const resolved = await create(meta("Will MUSD total supply exceed 50M on 15 Oct 2026?", "defi", "The MUSD contract on Mezo mainnet reports totalSupply above 50,000,000 MUSD at 15 Oct 2026 00:00 UTC.", "totalSupply is at or below 50,000,000 MUSD at that time.", ["Mezo explorer, MUSD token", "https://explorer.mezo.org/token/0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186"], t0 + 2n * H), 2n * H, 250, 6000);
  const invalid = await create(meta("Will the Mezo hackathon announce at least 10 winners by 30 Sep 2026?", "other", "mezo.org/blog publishes a winners post listing 10 or more winning teams before 30 Sep 2026 23:59 UTC.", "The post lists fewer than 10 winners, or no post appears by then.", ["Mezo blog", "https://mezo.org/blog"], t0 + 2n * H), 2n * H, 100, 5000);

  console.log("trading");
  await trade("alice", open, true, 120);
  await trade("bob", open, false, 60);
  await trade("carol", open, true, 35);
  await trade("alice", awaiting, true, 20);
  await trade("bob", proposed, false, 40);
  await trade("alice", proposed, true, 25);
  await trade("alice", disputed, true, 30);
  await trade("bob", disputed, false, 30);
  await trade("alice", resolved, true, 50);
  await trade("bob", resolved, false, 20);
  await trade("carol", resolved, true, 15);
  await trade("alice", invalid, false, 10);
  await trade("bob", invalid, true, 10);
  await send(w("bob").writeContract({ address: MARKETS, abi: mezonkMarketsAbi, functionName: "sell", args: [open, false, M(20), 0n, 2n ** 63n] }));

  console.log("resolution: closing, proposing, challenging");
  await warp(Number(2n * H + 60n));
  await propose(resolved, "yes", "The explorer's token page shows MUSD totalSupply of 54.2M at the evaluation time, above the 50M threshold.", "https://explorer.mezo.org/token/0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186");
  await propose(disputed, "no", "Binance's 20 Oct daily candle for ETHBTC closed at 0.03871, at or below 0.04000.", "https://www.binance.com/en/trade/ETH_BTC");
  const d = await evidence(disputed, "bob", "dispute", "yes", "The proposal used the wrong day's candle. The 20 Oct UTC close was 0.04012, above the threshold.", "https://www.binance.com/en/trade/ETH_BTC");
  await send(w("bob").writeContract({ address: MARKETS, abi: mezonkMarketsAbi, functionName: "dispute", args: [disputed, d.hash, d.uri] }));

  await warp(Number(D + 60n));
  await send(w("carol").writeContract({ address: MARKETS, abi: mezonkMarketsAbi, functionName: "finalize", args: [resolved] }));
  await send(w("alice").writeContract({ address: MARKETS, abi: mezonkMarketsAbi, functionName: "redeem", args: [resolved] }));

  await warp(Number(2n * D + 60n));
  await send(w("carol").writeContract({ address: MARKETS, abi: mezonkMarketsAbi, functionName: "finalize", args: [invalid] }));

  await warp(Number(2n * H));
  await propose(proposed, "yes", "BLS reported CPI-U 12-month change of 3.1% for October 2026, at or above 3.0%.", "https://www.bls.gov/cpi/");

  console.log(`done. markets: open #${open}, awaiting #${awaiting}, proposed #${proposed}, disputed #${disputed}, resolved #${resolved}, invalid #${invalid}`);
  console.log("note: chain time was advanced; the browser clock and chain clock now differ on this fork.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
