/**
 * Auto-refill market maker for MEZONK on Mezo Testnet. Keeps a small ladder of the bot wallet's own resting buy
 * orders on both sides of every live market, so testers always have something to buy.
 *
 * Per market the "favourite" outcome is inferred from the bot's own orders (the outcome it has bid above 50¢ on;
 * demo:markets seeds 85/84/83 on the favourite and 8/7/6 on the long shot). On each side the bot keeps MM_LEVELS
 * price levels that each have at least MM_SHARES/4 remaining. When levels fill out it places MM_SHARES at the next
 * price one cent further from the spread than its lowest order so far (85,84,83 → 82,81…; 8,7,6 → 5,4…), so the
 * price walks as testers buy. It never cancels, never crosses the book and never escrows more than MM_BUDGET_MUSD.
 *
 * Signing, two ways. Testnet only either way.
 *  - On your machine: a Foundry keystore via `cast`. The password is asked once, kept in a 0600 temp file for the run
 *    and deleted on exit.
 *  - On a server (no one to type a password): MM_PRIVATE_KEY, the bot wallet's key, set as a secret in the host's
 *    environment. Use a wallet that only ever holds test funds. Never commit it or put it in a NEXT_PUBLIC_ variable.
 *
 *   MM_ACCOUNT=creator pnpm --filter web mm
 *   MM_PRIVATE_KEY=0x… pnpm --filter web mm                    # server / container (see Dockerfile.mm)
 *   MM_DRY=1 MM_ONCE=1 MM_ADDRESS=0x… pnpm --filter web mm      # read-only: prints what it would place
 *
 * Env: MM_ACCOUNT (creator), MM_MARKETS (all live), MM_SHARES (100), MM_LEVELS (3), MM_BUDGET_MUSD (2000),
 *      MM_INTERVAL seconds (30), MM_CLOSE_MARGIN seconds (600), MM_ONCE=1, MM_DRY=1 + MM_ADDRESS.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Address,
  type Hex,
  type Transport,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { mezoTestnet } from "../src/lib/chain/config";
import { laggingNodeFetch } from "../src/lib/chain/laggingNodeFetch";
import { exchangeAbi } from "../src/lib/contracts/abi";

const RPC = "https://rpc.test.mezo.org";
const CHAIN_ID = 31611;
const EXCHANGE = "0x4555cfF10200e1007435Cffc683C60683c5C49B9" as Address;
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as Address;
const LOT = 10n ** 16n;
const YES = 0, NO = 1, BUY = 0;
const MIN_GAS = 10n ** 14n; // 0.0001 test BTC

// ─── Config ───────────────────────────────────────────────────────────────────

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v == null || v.trim() === "" ? fallback : v.trim();
}
function positiveInt(name: string, fallback: string): number {
  const n = Number(env(name, fallback));
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive whole number`);
  return n;
}

const DRY = env("MM_DRY", "") === "1";
const ONCE = env("MM_ONCE", "") === "1";
const ACCOUNT = env("MM_ACCOUNT", "creator");
const LEVELS = positiveInt("MM_LEVELS", "3");
const INTERVAL_MS = positiveInt("MM_INTERVAL", "30") * 1000;
const CLOSE_MARGIN = BigInt(positiveInt("MM_CLOSE_MARGIN", "600"));
const SHARES = parseUnits(env("MM_SHARES", "100"), 18);
const BUDGET = parseUnits(env("MM_BUDGET_MUSD", "2000"), 18);
const MARKETS: bigint[] | null = process.env.MM_MARKETS?.trim()
  ? process.env.MM_MARKETS.split(",").map((s) => BigInt(s.trim()))
  : null;
if (SHARES <= 0n || SHARES % LOT !== 0n) throw new Error("MM_SHARES must be a positive multiple of 0.01");
if (BUDGET <= 0n) throw new Error("MM_BUDGET_MUSD must be positive");
/** A level counts as stocked while it has at least this much left. */
const HEALTHY = SHARES / 4n;

// ─── Plumbing ─────────────────────────────────────────────────────────────────

const client = createPublicClient({
  transport: http(RPC, { retryCount: 5, retryDelay: 800, fetchFn: laggingNodeFetch }),
});
const dir = mkdtempSync(path.join(tmpdir(), "mezonk-mm-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

let stopping = false;
let wake: (() => void) | null = null;
process.on("SIGINT", () => {
  if (stopping) process.exit(130);
  stopping = true;
  console.log("\nStopping after the current step (Ctrl-C again to quit now).");
  wake?.();
});
// Hosts stop containers with SIGTERM: finish the current step, then exit.
process.on("SIGTERM", () => {
  stopping = true;
  wake?.();
});

/**
 * Free hosts that only run web services (e.g. Render's free tier) need something listening on $PORT, and sleep
 * without traffic; an uptime pinger hitting /health keeps it awake. Reports the last pass so the ping is useful.
 * Off when PORT isn't set (local runs).
 */
let lastPass = { at: "", summary: "starting" };
if (process.env.PORT) {
  createServer((req, res) => {
    res.writeHead(req.url === "/health" || req.url === "/" ? 200 : 404, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify({ ok: true, lastPass }));
  }).listen(Number(process.env.PORT), "0.0.0.0");
}

const sleep = (ms: number) =>
  new Promise<void>((res) => {
    const t = setTimeout(() => ((wake = null), res()), ms);
    wake = () => (clearTimeout(t), (wake = null), res());
  });

async function retry<T>(label: string, fn: () => Promise<T>, tries = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= tries || stopping) throw new Error(`${label}: ${short(e)}`);
      await new Promise((r) => setTimeout(r, 1000 * i));
    }
  }
}
const short = (e: unknown) => ((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? String(e)).split("\n")[0];

function askHidden(q: string): Promise<string> {
  const mute = new Writable({ write: (_c, _e, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: mute, terminal: true });
  process.stdout.write(q);
  return new Promise((res) => rl.question("", (a) => (rl.close(), process.stdout.write("\n"), res(a))));
}

function cast(args: string[]): string {
  return execFileSync("cast", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

type Signer =
  | { kind: "cast"; name: string; pwFile: string; address: Address }
  | { kind: "key"; address: Address; wallet: WalletClient<Transport, typeof mezoTestnet, PrivateKeyAccount> };
async function signer(name: string): Promise<Signer> {
  const key = process.env.MM_PRIVATE_KEY?.trim();
  if (key) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("MM_PRIVATE_KEY must be 0x followed by 64 hex characters");
    const account = privateKeyToAccount(key as Hex);
    const wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(RPC, { retryCount: 3, retryDelay: 1000, fetchFn: laggingNodeFetch }) });
    return { kind: "key", address: account.address, wallet };
  }
  const pwFile = path.join(dir, `${name}.pw`);
  writeFileSync(pwFile, await askHidden(`Password for keystore "${name}": `), { mode: 0o600 });
  const address = getAddress(cast(["wallet", "address", "--account", name, "--password-file", pwFile]).trim());
  return { kind: "cast", name, pwFile, address };
}

/** Highest block we know is mined (receipts we waited for); reads are pinned at or after it. */
let minBlock = 0n;

async function send(s: Signer, to: Address, data: Hex, label: string) {
  let hash: Hex;
  try {
    // Sent once, never retried here: a retry after a broadcast that did land could place the order twice.
    // A failed pass is retried on the next pass, which re-reads the book first.
    hash =
      s.kind === "key"
        ? await s.wallet.sendTransaction({ to, data })
        : (cast(["send", to, data, "--account", s.name, "--password-file", s.pwFile, "--rpc-url", RPC, "--async"]).trim() as Hex);
  } catch (e) {
    const msg = (e as { stderr?: string }).stderr || short(e) || String(e);
    throw new Error(`${label} failed: ${msg.trim().split("\n").slice(-3).join(" ")}`);
  }
  // The public RPC sometimes serves a lagging node that returns null receipts; poll by hash until it's mined.
  const r = await client.waitForTransactionReceipt({ hash, pollingInterval: 2000, timeout: 180_000, retryCount: 20 });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  if (r.blockNumber > minBlock) minBlock = r.blockNumber;
  console.log(`  ✓ ${label} (${hash.slice(0, 12)}…)`);
  return r;
}

// ─── Formatting (bigint only) ─────────────────────────────────────────────────

function dec2(x: bigint): string {
  const neg = x < 0n;
  const c = (neg ? -x : x) / LOT; // hundredths
  return `${neg ? "-" : ""}${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;
}
const musd = (x: bigint) => `${dec2(x)} MUSD`;
const shares = (x: bigint) => dec2(x).replace(/\.00$/, "");
const side = (o: number) => (o === YES ? "Yes" : "No");
const cost = (q: bigint, cents: number) => (q * BigInt(cents)) / 100n;

// ─── Book cache ───────────────────────────────────────────────────────────────

interface Resting { id: bigint; maker: Address; outcome: number; side: number; price: number; marketId: bigint; remaining: bigint }

/**
 * Resting orders by id. Remaining only ever goes down, so a stale read can't resurrect filled depth, and an
 * order we just placed (taken from its receipt) can't vanish because a lagging node hasn't seen it yet.
 */
const book = new Map<bigint, Resting>();
let knownCount = 0n;

async function refreshBook(bot: Address, at: bigint) {
  const n = await retry("restingCount", () => client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "restingCount", blockNumber: at }));
  if (n > knownCount) knownCount = n;
  const todo: bigint[] = [];
  for (let i = 1n; i <= knownCount; i++) {
    const c = book.get(i);
    // Other makers' orders are only needed for their identity; the bot's open orders are re-read for fills.
    if (!c || (c.maker === bot && c.remaining > 0n)) todo.push(i);
  }
  for (let k = 0; k < todo.length; k += 10) {
    await Promise.all(
      todo.slice(k, k + 10).map(async (id) => {
        const o = await retry(`getResting(${id})`, () => client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "getResting", args: [id], blockNumber: at }));
        if (o.maker === "0x0000000000000000000000000000000000000000") return; // not visible yet on this node
        const prev = book.get(id);
        book.set(id, {
          id,
          maker: getAddress(o.maker),
          outcome: o.outcome,
          side: o.side,
          price: o.price,
          marketId: o.marketId,
          remaining: prev && prev.remaining < o.remaining ? prev.remaining : o.remaining,
        });
      }),
    );
  }
}

const botBuys = (bot: Address) => [...book.values()].filter((o) => o.maker === bot && o.side === BUY);
const escrowOf = (orders: Resting[]) => orders.reduce((a, o) => a + cost(o.remaining, o.price), 0n);

// ─── One pass ─────────────────────────────────────────────────────────────────

interface Wallet { address: Address; signer: Signer | null; balance: bigint; allowance: bigint; approved: boolean }

interface Plan { outcome: number; price: number }

/** Prices to add on one side so it has LEVELS stocked levels, walking away from the spread. */
function planSide(mine: Resting[], outcome: number, bid: number, ask: number, log: (s: string) => void): Plan[] {
  const all = mine.filter((o) => o.outcome === outcome);
  if (all.length === 0) {
    log(`no ${side(outcome)} orders of its own to start a ladder from; skipping that side`);
    return [];
  }
  const left = new Map<number, bigint>();
  for (const o of all) if (o.remaining > 0n) left.set(o.price, (left.get(o.price) ?? 0n) + o.remaining);
  const stocked = [...left.values()].filter((q) => q >= HEALTHY).length;
  const out: Plan[] = [];
  let p = Math.min(...all.map((o) => o.price)) - 1; // one cent past the bot's lowest order on this side, ever
  for (let need = LEVELS - stocked; need > 0; p--) {
    if (p < 1) {
      log(`${side(outcome)} ladder reached 1¢; nothing further to place`);
      break;
    }
    // A YES bid at p crosses an ask at or below p; a NO bid at p is a YES ask at 100 − p and crosses a bid at or above it.
    const crosses = outcome === YES ? ask !== 0 && p >= ask : bid !== 0 && 100 - p <= bid;
    if (crosses) {
      log(`${side(outcome)} at ${p}¢ would cross the book (best bid ${bid}¢, ask ${ask}¢); skipping that price`);
      continue;
    }
    out.push({ outcome, price: p });
    need--;
  }
  return out;
}

function ladderText(mine: Resting[], outcome: number): string {
  const left = new Map<number, bigint>();
  for (const o of mine) if (o.outcome === outcome && o.remaining > 0n) left.set(o.price, (left.get(o.price) ?? 0n) + o.remaining);
  const lv = [...left.entries()].sort((a, b) => b[0] - a[0]).map(([p, q]) => `${p}×${shares(q)}`);
  return `${side(outcome)} bids ${lv.length ? lv.join(" ") : "none"}`;
}

async function marketIds(at: bigint): Promise<bigint[]> {
  if (MARKETS) return MARKETS;
  const n = await retry("marketCount", () => client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "marketCount", blockNumber: at }));
  return Array.from({ length: Number(n) }, (_, i) => BigInt(i + 1));
}

let chainNow = 0n;

async function pass(w: Wallet) {
  let head = await retry("blockNumber", () => client.getBlockNumber({ cacheTime: 0 }));
  if (head < minBlock) head = minBlock; // never read state older than our own last transaction
  const blk = await retry("block", () => client.getBlock({ blockNumber: head }));
  if (blk.timestamp > chainNow) chainNow = blk.timestamp;
  const paused = await retry("paused", () => client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "paused", blockNumber: head }));
  if (paused) return console.log(`[block ${head}] exchange is paused; not quoting`);

  await refreshBook(w.address, head);
  [w.balance, w.allowance] = await Promise.all([
    retry("balance", () => client.readContract({ address: MUSD, abi: erc20Abi, functionName: "balanceOf", args: [w.address], blockNumber: head })),
    retry("allowance", () => client.readContract({ address: MUSD, abi: erc20Abi, functionName: "allowance", args: [w.address, EXCHANGE], blockNumber: head })),
  ]);
  let escrowed = escrowOf(botBuys(w.address));
  console.log(`[block ${head}] wallet ${musd(w.balance)} free, ${musd(escrowed)} escrowed of ${musd(BUDGET)} budget`);

  for (const id of await marketIds(head)) {
    if (stopping) return;
    const log = (s: string) => console.log(`  market #${id}: ${s}`);
    try {
      const m = await retry(`getMarket(${id})`, () => client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "getMarket", args: [id], blockNumber: head }));
      if (m.graduatedAt === 0n) { log("not launched; skipping"); continue; }
      if (m.finalized) { log("finalized; skipping"); continue; }
      if (chainNow >= m.closeTime - CLOSE_MARGIN) { log(`closes ${chainNow >= m.closeTime ? "passed" : "within the safety margin"}; skipping`); continue; }

      const mine = () => botBuys(w.address).filter((o) => o.marketId === id);
      const maxAt = (o: number) => Math.max(0, ...mine().filter((x) => x.outcome === o).map((x) => x.price));
      const yesHi = maxAt(YES) > 50, noHi = maxAt(NO) > 50;
      if (yesHi === noHi) { log("can't tell the favourite from the bot's own orders; skipping"); continue; }
      const fav = yesHi ? YES : NO, long = fav === YES ? NO : YES;

      const [bid, ask] = await retry("bestPrices", () => client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "bestPrices", args: [id], blockNumber: head }));
      const plans = [...planSide(mine(), fav, bid, ask, log), ...planSide(mine(), long, bid, ask, log)];

      // A side that can't afford its next price stops there, so the ladder never leaves a gap it can't fill later.
      const blocked = new Set<number>();
      for (const p of plans) {
        if (stopping) return;
        if (blocked.has(p.outcome)) continue;
        const c = cost(SHARES, p.price);
        const label = `buy ${side(p.outcome)} at ${p.price}¢ × ${shares(SHARES)} (${musd(c)})`;
        if (escrowed + c > BUDGET) { log(`${label} would take escrow to ${musd(escrowed + c)}, over the ${musd(BUDGET)} budget; skipping this side`); blocked.add(p.outcome); continue; }
        if (w.balance < c) { log(`${label} needs ${musd(c)} but the wallet has ${musd(w.balance)}; top it up. Skipping this side`); blocked.add(p.outcome); continue; }
        if (!w.signer) {
          log(`would ${label}${w.allowance < c ? " (after approving MUSD)" : ""}`);
          w.balance -= c;
          w.allowance = w.allowance > c ? w.allowance - c : 0n;
          escrowed += c;
          continue;
        }
        if (w.allowance < c) {
          if (w.approved) { log(`MUSD allowance is short again after approving; skipping ${label}`); blocked.add(p.outcome); continue; }
          const amount = BUDGET * 10n;
          await send(w.signer, MUSD, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [EXCHANGE, amount] }), `approve the exchange for ${musd(amount)}`);
          w.allowance = amount;
          w.approved = true;
        }
        const r = await send(w.signer, EXCHANGE, encodeFunctionData({ abi: exchangeAbi, functionName: "placeOrder", args: [id, p.outcome, BUY, p.price, SHARES] }), `market #${id}: ${label}`);
        w.balance -= c;
        w.allowance -= c;
        escrowed += c;
        for (const ev of parseEventLogs({ abi: exchangeAbi, logs: r.logs, eventName: "OrderPlaced" })) {
          const a = ev.args;
          book.set(a.orderId, { id: a.orderId, maker: getAddress(a.maker), outcome: a.outcome, side: a.side, price: a.price, marketId: a.marketId, remaining: a.quantity });
          if (a.orderId > knownCount) knownCount = a.orderId;
        }
      }
      const now = mine();
      console.log(`market #${id}: ${ladderText(now, fav)} | ${ladderText(now, long)}, escrowed ${musd(escrowOf(now))}`);
    } catch (e) {
      log(`error: ${short(e)}`);
    }
  }
  console.log(`pass done: ${musd(escrowed)} escrowed of ${musd(BUDGET)}${w.signer ? "" : " (dry run, includes would-place orders)"}`);
  lastPass = { at: new Date().toISOString(), summary: `${musd(escrowed)} escrowed of ${musd(BUDGET)}` };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const chainId = await retry("chainId", () => client.getChainId());
  if (chainId !== CHAIN_ID) throw new Error(`RPC is chain ${chainId}, expected Mezo Testnet`);

  let w: Wallet;
  if (DRY) {
    const a = process.env.MM_ADDRESS?.trim() ?? "";
    if (!isAddress(a)) throw new Error("MM_DRY=1 needs MM_ADDRESS=0x… (the bot wallet to read)");
    w = { address: getAddress(a), signer: null, balance: 0n, allowance: 0n, approved: false };
    console.log(`Dry run for ${w.address}: reads only, nothing is signed or sent.`);
  } else {
    const s = await signer(ACCOUNT);
    w = { address: s.address, signer: s, balance: 0n, allowance: 0n, approved: false };
    console.log(`Market maker running as ${s.kind === "key" ? "MM_PRIVATE_KEY" : ACCOUNT} (${s.address}) on Mezo Testnet.`);
  }
  console.log(
    `Shares ${shares(SHARES)} per level, ${LEVELS} levels per side, budget ${musd(BUDGET)}, markets ${MARKETS ? MARKETS.join(",") : "all live"}, ` +
      `${ONCE ? "one pass" : `every ${INTERVAL_MS / 1000}s`}.`,
  );

  while (!stopping) {
    try {
      if (w.signer) {
        const gas = await retry("gas balance", () => client.getBalance({ address: w.address }));
        if (gas < MIN_GAS) console.log(`${w.address} is low on test BTC for gas (${dec2(gas)}); get some at https://faucet.test.mezo.org/`);
        else await pass(w);
      } else await pass(w);
    } catch (e) {
      console.log(`pass failed: ${short(e)}`);
    }
    if (ONCE || stopping) break;
    await sleep(INTERVAL_MS);
  }
  console.log("Market maker stopped.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\nStopped: ${short(e)}`);
    process.exit(1);
  });

