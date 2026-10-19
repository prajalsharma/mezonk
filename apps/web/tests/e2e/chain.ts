import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { createTestClient, createWalletClient, http, parseUnits, publicActions, type Address, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezonkMarketsAbi } from "../../src/lib/contracts/abi";
import { serializeMetadata } from "../../src/lib/market/metadata";
import { serializeEvidence } from "../../src/lib/market/evidence";

const env = Object.fromEntries(
  readFileSync(path.join(__dirname, "../../.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]),
);
export const RPC = env.NEXT_PUBLIC_RPC_URL!;
export const MARKETS = env.NEXT_PUBLIC_MARKETS_ADDRESS as Address;
const API = process.env.APP_URL ?? "http://localhost:3000";
if (!/127\.0\.0\.1|localhost/.test(RPC)) throw new Error("E2E only runs against a local fork");

const KEYS = {
  resolver: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  arbitrator: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  creator: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  alice: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  bob: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
} as const;
export type Role = keyof typeof KEYS;
const chain = { id: 31611, name: "fork", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [RPC] } } } as const;
export const client = createTestClient({ mode: "anvil", chain, transport: http(RPC) }).extend(publicActions);
const w = (r: Role) => createWalletClient({ account: privateKeyToAccount(KEYS[r]), chain, transport: http(RPC) });
export const addr = (r: Role) => privateKeyToAccount(KEYS[r]).address;
const E = (n: number) => parseUnits(String(n), 18);
const send = async (p: Promise<Hash>) => {
  const r = await client.waitForTransactionReceipt({ hash: await p });
  if (r.status !== "success") throw new Error("reverted");
};
const call = (r: Role, functionName: string, args: unknown[]) =>
  send(w(r).writeContract({ address: MARKETS, abi: mezonkMarketsAbi, functionName, args } as never));

export const read = <T>(functionName: string, args: unknown[]) =>
  client.readContract({ address: MARKETS, abi: mezonkMarketsAbi, functionName, args } as never) as Promise<T>;
export const stage = (id: bigint) => read<number>("stageOf", [id]);

export async function warp(secs: number) {
  await client.increaseTime({ seconds: secs });
  await client.mine({ blocks: 1 });
}

/** A fresh market for one test: alice buys Yes, bob buys No, then trading closes. */
export async function closedMarket(label: string) {
  // Mine first so "latest" reflects current chain time; the tx lands in the next block.
  await client.mine({ blocks: 1 });
  const t = (await client.getBlock()).timestamp;
  const metadata = serializeMetadata({
    v: 1,
    question: `E2E ${label}: will the test outcome be Yes on 1 Jan 2030?`,
    category: "other",
    description: "End-to-end test market on a local fork.",
    rules: { yes: "The E2E resolver proposes Yes and it stands.", no: "The E2E resolver proposes No and it stands.", invalid: "The E2E run aborts before resolution.", ambiguity: "" },
    source: { name: "E2E", url: "https://example.org/e2e" },
    resolvesAt: new Date(Number(t + 7200n) * 1000).toISOString(),
  });
  await call("creator", "createMarket", [{ metadata, closeTime: t + 7200n, resolver: addr("resolver"), initialLiquidity: E(100), initialYesProbBps: 5000 }]);
  const id = await read<bigint>("marketCount", []);
  await call("alice", "buy", [id, true, E(20), 0n, 2n ** 63n]);
  await call("bob", "buy", [id, false, E(20), 0n, 2n ** 63n]);
  await warp(7300);
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
  await call("resolver", "proposeOutcome", [id, o === "yes" ? 1 : 2, d.hash, d.uri]);
}
export async function disputeDirect(id: bigint) {
  const d = await doc(id, "bob", "dispute", "no");
  await call("bob", "dispute", [id, d.hash, d.uri]);
}
export const finalizeDirect = (id: bigint) => call("bob", "finalize", [id]);

/** Connect one of the local test wallets through the real RainbowKit modal. */
export async function connect(page: Page, role: Role | "visitor" | "rejects") {
  if (role === "visitor") return;
  // The mock test connector does not auto-reconnect after reload the way browser wallets do.
  if (await page.getByRole("button", { name: /Account / }).isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Connect wallet" }).first().click();
  await page.getByRole("button", { name: `Test wallet: ${role}` }).click();
  await page.getByRole("button", { name: /Account / }).waitFor();
}

/** Send without waiting (for mempool ordering tests). */
export async function sendNoWait(r: Role, functionName: string, args: unknown[], tipGwei: number) {
  return w(r).writeContract({
    address: MARKETS,
    abi: mezonkMarketsAbi,
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
