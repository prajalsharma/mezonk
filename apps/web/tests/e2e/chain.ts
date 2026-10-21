import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createTestClient, createWalletClient, erc20Abi, http, parseUnits, publicActions, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { protocolAddresses } from "../../src/lib/chain/config";
import { exchangeAbi, factoryAbi, resolutionAbi } from "../../src/lib/contracts/abi";
import { serializeMetadata } from "../../src/lib/market/metadata";
import { serializeEvidence } from "../../src/lib/market/evidence";
import { ANVIL_CURATOR_PK, signedCreateArgs } from "../../scripts/lib/approval-sign";

const env = Object.fromEntries(
  readFileSync(path.join(__dirname, "../../.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
export const RPC = env.NEXT_PUBLIC_RPC_URL!;
export const P = protocolAddresses(env.NEXT_PUBLIC_MARKETS_ADDRESS as Address);
export const EXCHANGE = P.marketsAddress;
export const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as Address;
const API = process.env.APP_URL ?? "http://localhost:3000";
if (!/127\.0\.0\.1|localhost/.test(RPC)) throw new Error("E2E only runs against a local fork");

const KEYS = {
  resolver: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  arbitrator: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  creator: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  alice: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  bob: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  carol: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  curator: ANVIL_CURATOR_PK,
} as const;
export type Role = keyof typeof KEYS;
export const YES = 0, NO = 1, BUY = 0, SELL = 1;
const ZERO = "0x0000000000000000000000000000000000000000" as const;
const chain = { id: 31611, name: "fork", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
export const client = createTestClient({ mode: "anvil", chain, transport: http(RPC) }).extend(publicActions);
const w = (r: Role) => createWalletClient({ account: privateKeyToAccount(KEYS[r]), chain, transport: http(RPC) });
export const addr = (r: Role) => privateKeyToAccount(KEYS[r]).address;
export const E = (n: number) => parseUnits(String(n), 18);
const send = async (p: Promise<Hash>) => {
  const r = await client.waitForTransactionReceipt({ hash: await p });
  if (r.status !== "success") throw new Error("reverted");
};

/** Exchange calls (trading, seeding, settlement). */
export const call = (r: Role, functionName: string, args: unknown[]) =>
  send(w(r).writeContract({ address: EXCHANGE, abi: exchangeAbi, functionName, args } as never));
/** Factory calls (publication). */
export const callFactory = (r: Role, functionName: string, args: unknown[]) =>
  send(w(r).writeContract({ address: P.factoryAddress, abi: factoryAbi, functionName, args } as never));
/** Resolution calls (propose, dispute, arbitrate, finalize, bonds). */
export const callRes = (r: Role, functionName: string, args: unknown[]) =>
  send(w(r).writeContract({ address: P.resolutionAddress, abi: resolutionAbi, functionName, args } as never));

export const read = <T>(functionName: string, args: unknown[]) =>
  client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName, args } as never) as Promise<T>;
export const readFactory = <T>(functionName: string, args: unknown[]) =>
  client.readContract({ address: P.factoryAddress, abi: factoryAbi, functionName, args } as never) as Promise<T>;
export const readRes = <T>(functionName: string, args: unknown[]) =>
  client.readContract({ address: P.resolutionAddress, abi: resolutionAbi, functionName, args } as never) as Promise<T>;
/** Resolution stage: 1 awaiting proposal, 2 proposed, 3 disputed, 4 finalized. */
export const stage = (id: bigint) => readRes<number>("stageOf", [id]);
/** Exchange stage: 0 seeding, 1 live, 2 failed, 3 closed, 4 finalized. */
export const exStage = (id: bigint) => read<number>("stageOf", [id]);
export const musdOf = (a: Address) => client.readContract({ address: MUSD, abi: erc20Abi, functionName: "balanceOf", args: [a] });
/** What redeem() would pay right now, from share balances and the final outcome. */
export async function claimable(id: bigint, who: Address) {
  const m = await read<{ finalized: boolean; finalOutcome: number }>("getMarket", [id]);
  if (!m.finalized) return 0n;
  const y = await read<bigint>("sharesOf", [id, YES, who]);
  const n = await read<bigint>("sharesOf", [id, NO, who]);
  return m.finalOutcome === 1 ? y : m.finalOutcome === 2 ? n : (y + n) / 2n;
}

export async function warp(secs: number) {
  await client.increaseTime({ seconds: secs });
  await client.mine({ blocks: 1 });
}

/** Every E2E wallet may spend MUSD on the exchange and the resolution contract (bonds). */
let approved = false;
async function approveAll() {
  if (approved) return;
  for (const r of Object.keys(KEYS) as Role[]) {
    for (const spender of [EXCHANGE, P.resolutionAddress]) {
      await send(w(r).writeContract({ address: MUSD, abi: erc20Abi, functionName: "approve", args: [spender, 2n ** 255n] }));
    }
  }
  approved = true;
}

const restingSources = (ids: bigint[]) =>
  ids.map((restingId) => ({
    restingId,
    order: { maker: ZERO, taker: ZERO, marketId: 0n, outcome: 0, side: 0, price: 0, quantity: 0n, expiry: 0n, nonce: 0n, salt: 0n },
    signature: "0x" as const,
  }));
export async function restingIds(id: bigint, outcome: number, side = BUY) {
  const n = await read<bigint>("restingCount", []);
  const out: bigint[] = [];
  for (let i = 1n; i <= n; i++) {
    const o = await read<{ marketId: bigint; outcome: number; side: number; remaining: bigint }>("getResting", [i]);
    if (o.marketId === id && o.outcome === outcome && o.side === side && o.remaining > 0n) out.push(i);
  }
  return out;
}
export async function takeResting(r: Role, id: bigint, outcome: number, side: number, limit: number, qty: bigint, ids: bigint[]) {
  const t = (await client.getBlock()).timestamp;
  await call(r, "take", [{ marketId: id, outcome, side, limitPrice: limit, quantity: qty, minFill: 0n, deadline: t + 600n }, restingSources(ids)]);
}

function metaFor(label: string, t: bigint) {
  return serializeMetadata({
    v: 1,
    question: `E2E ${label}: will the test outcome be Yes on 1 Jan 2030?`,
    category: "other",
    description: "End-to-end test market on a local fork.",
    rules: { yes: "The E2E resolver proposes Yes and it stands.", no: "The E2E resolver proposes No and it stands.", invalid: "The E2E run aborts before resolution.", ambiguity: "" },
    source: { name: "E2E", url: "https://example.org/e2e" },
    resolvesAt: new Date(Number(t + 4n * 86400n) * 1000).toISOString(),
  });
}

/** A fresh market in SEEDING (curator-approved, published by the creator). Close is `closeIn` seconds out. */
export async function seedingMarket(label: string, closeIn = 4n * 86400n) {
  await approveAll();
  await client.mine({ blocks: 1 }); // "latest" reflects current chain time; the tx lands in the next block
  const t = (await client.getBlock()).timestamp;
  const policyId = Number(await read<number>("policyCount", []));
  const args = await signedCreateArgs(ANVIL_CURATOR_PK, 31611, P.factoryAddress, addr("creator"), { metadata: metaFor(label, t), closeTime: t + closeIn, resolver: addr("resolver"), policyId }, t);
  await callFactory("creator", "createMarket", [...args]);
  return read<bigint>("marketCount", []);
}

/** Alice bids Yes 45, bob bids No 45 (a Yes ask at 55), 80 shares each: enough for the local policy. Then launch. */
export async function seedAndLaunch(id: bigint) {
  await call("alice", "placeOrder", [id, YES, BUY, 45, E(80)]);
  await call("bob", "placeOrder", [id, NO, BUY, 45, E(80)]);
  await call("carol", "graduate", [id]);
}

/** A live market with real fills: alice ends up long Yes, bob long No. */
export async function liveMarket(label: string) {
  const id = await seedingMarket(label);
  await seedAndLaunch(id);
  await takeResting("alice", id, YES, BUY, 60, E(20), await restingIds(id, NO));
  await takeResting("bob", id, NO, BUY, 60, E(20), await restingIds(id, YES));
  await waitIndexed(id);
  return id;
}

/** A fresh market for one resolution test: seeded, launched, traded, then closed. */
export async function closedMarket(label: string) {
  const id = await seedingMarket(label, 3n * 3600n + 600n); // 2h seeding + 1h minimum live, then close
  await seedAndLaunch(id);
  await takeResting("alice", id, YES, BUY, 60, E(20), await restingIds(id, NO));
  await takeResting("bob", id, NO, BUY, 60, E(20), await restingIds(id, YES));
  await warp(3 * 3600 + 700);
  await waitIndexed(id);
  return id;
}

export async function waitIndexed(id: bigint) {
  for (let i = 0; i < 60; i++) {
    if ((await fetch(`${API}/api/markets/${id}`)).ok) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("not indexed");
}

async function doc(id: bigint, r: Role, kind: "proposal" | "dispute", outcome: "yes" | "no") {
  const d = { v: 1 as const, kind, marketId: Number(id), outcome, summary: "Setup step for an end-to-end test, not a real claim.", links: [{ url: "https://example.org/e2e", label: "" }], author: addr(r).toLowerCase(), createdAt: new Date().toISOString() };
  const res = await fetch(`${API}/api/evidence-documents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
  const j = await res.json();
  if (j.raw !== serializeEvidence(d)) throw new Error("serialization mismatch");
  return j as { hash: `0x${string}`; uri: string };
}
export async function proposeDirect(id: bigint, o: "yes" | "no") {
  const d = await doc(id, "resolver", "proposal", o);
  await callRes("resolver", "proposeOutcome", [id, o === "yes" ? 1 : 2, d.hash, d.uri]);
}
export async function disputeDirect(id: bigint) {
  const d = await doc(id, "bob", "dispute", "no");
  await callRes("bob", "dispute", [id, d.hash, d.uri]);
}
export const finalizeDirect = (id: bigint) => callRes("bob", "finalize", [id]);

/** Connect one of the local test wallets through the real RainbowKit modal. */
export async function connect(page: Page, role: Role | "visitor" | "rejects") {
  if (role === "visitor") return;
  // The mock test connector does not auto-reconnect after reload the way browser wallets do.
  if (await page.getByRole("button", { name: /Account / }).isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByRole("button", { name: `Test wallet: ${role}` }).click();
  await page.getByRole("button", { name: /Account / }).waitFor();
}

/** Send to the resolution contract without waiting (for mempool ordering tests). */
export async function sendNoWait(r: Role, functionName: string, args: unknown[], tipGwei: number) {
  return w(r).writeContract({
    address: P.resolutionAddress,
    abi: resolutionAbi,
    functionName,
    args,
    gas: 400_000n, // skip estimation: it would run against the pending block
    maxPriorityFeePerGas: BigInt(tipGwei) * 10n ** 9n,
    maxFeePerGas: BigInt(tipGwei + 50) * 10n ** 9n,
  } as never);
}
export async function evidenceFor(id: bigint, r: Role) {
  const d = { v: 1 as const, kind: "dispute" as const, marketId: Number(id), outcome: "no" as const, summary: "Racing challenge used to test a reverted transaction.", links: [{ url: "https://example.org/race", label: "" }], author: addr(r).toLowerCase(), createdAt: new Date().toISOString() };
  const res = await fetch(`${API}/api/evidence-documents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
  return (await res.json()) as { hash: `0x${string}`; uri: string };
}
export const setAutomine = (on: boolean) => client.setAutomine(on);
export const chainNow = async () => Number((await client.getBlock()).timestamp) * 1000;
