/**
 * Lists the three demo markets on the live testnet site through the same path a person would take:
 * suggest (creator wallet) → review and approve (curator wallet) → publish → seed → launch.
 * Proposals, the review trail and cover images all land in the app; nothing is written to its database directly.
 *
 * Signing happens on this machine with Foundry keystores via `cast`. Passwords are asked once, kept in a
 * 0600 temp file for the run and deleted on exit. No key or password is sent anywhere.
 *
 *   CURATOR_ACCOUNT=deployer CREATOR_ACCOUNT=creator pnpm --filter web demo:markets
 *
 * The curator account must also own the factory (it approves the creator if needed). Testnet only.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  parseEventLogs,
  parseUnits,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { protocolAddresses } from "../src/lib/chain/config";
import { exchangeAbi, factoryAbi } from "../src/lib/contracts/abi";
import { approvalTypes, type StoredApproval } from "../src/lib/governance/approval";
import { REVIEW_CHECKLIST } from "../src/lib/governance/proposal";
import { metadataHash, serializeMetadata, type MarketMetadata } from "../src/lib/market/metadata";

const APP = process.env.APP_URL ?? "https://www.mezonk.xyz";
const RPC = "https://rpc.test.mezo.org";
const CHAIN_ID = 31611;
const EXCHANGE = "0x4555cfF10200e1007435Cffc683C60683c5C49B9" as Address;
const MUSD = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503" as Address;
const P = protocolAddresses(EXCHANGE);
const CURATOR = process.env.CURATOR_ACCOUNT ?? "deployer";
const CREATOR = process.env.CREATOR_ACCOUNT ?? "creator";
const COVERS = process.env.COVERS_DIR ?? path.join(process.env.HOME ?? "", "Pictures/shubham/mezonk-covers");
const SHARES = 20; // per side, the policy's minimum depth
/** Extra depth after launch: this many shares at each ladder price on both sides (0 = none). */
const LADDER = Number(process.env.LADDER_SHARES ?? 100);
const FAV_LADDER = [85, 84, 83]; // favourite bids: the long shot is buyable from 15¢
const LONG_LADDER = [8, 7, 6]; // long-shot bids: the favourite is buyable from 92¢
const S = (n: number) => parseUnits(String(n), 18);
const YES = 0, NO = 1, BUY = 0;

type Side = "yes" | "no";
interface Demo {
  key: string;
  metadata: MarketMetadata;
  closeTime: string;
  summary: string;
  rationale: string;
  cover: string;
  /** Which side the market thinks is likely. The other side is offered cheap (15¢). */
  favourite: Side | "btc-spot";
}

const FED_FAV = (process.env.FED_FAVOURITE ?? "") as Side;
const HOUSE_FAV = (process.env.HOUSE_FAVOURITE ?? "") as Side;

const DEMOS: Demo[] = [
  {
    key: "fed",
    favourite: FED_FAV,
    cover: "fed-cover.jpg",
    closeTime: "2026-10-28T17:00:00.000Z",
    summary: "Yes if the FOMC lowers the federal funds target range on October 28, 2026.",
    rationale: "Rate decisions move Bitcoin. A clear, official answer on a fixed date that resolves within days.",
    metadata: {
      v: 1,
      question: "Will the Fed cut interest rates at its October 27–28, 2026 meeting?",
      category: "economics",
      description: "The FOMC statement is usually released at 2:00 pm ET (18:00 UTC) on the meeting's last day, October 28, 2026.",
      rules: {
        yes: "The FOMC statement released at the October 27–28, 2026 meeting lowers the target range for the federal funds rate.",
        no: "That statement holds the target range unchanged or raises it.",
        invalid: "The meeting is cancelled or moved past November 30, 2026, or no statement is released by then.",
        ambiguity: "Only the official FOMC statement counts. News reports and later minutes do not change the outcome.",
      },
      source: { name: "Federal Reserve FOMC statement", url: "https://www.federalreserve.gov/newsevents/pressreleases.htm" },
      resolvesAt: "2026-10-28T18:00:00.000Z",
    },
  },
  {
    key: "btc",
    favourite: "btc-spot",
    cover: "btc-cover.jpg",
    closeTime: "2026-10-31T23:00:00.000Z",
    summary: "Yes if Coinbase's BTC-USD daily close for Oct 31 is above $85,000.",
    rationale: "The simplest Bitcoin price question there is. Easy to check and a good first market for BTC holders.",
    metadata: {
      v: 1,
      question: "Will Bitcoin close above $85,000 on October 31, 2026 (UTC)?",
      category: "bitcoin",
      description: "Uses the Coinbase BTC-USD daily candle that opens at 00:00 UTC on October 31, 2026 and closes at 00:00 UTC on November 1.",
      rules: {
        yes: "The close price of Coinbase's BTC-USD daily candle for October 31, 2026 (UTC) is strictly above 85,000.00 USD.",
        no: "That close price is at or below 85,000.00 USD.",
        invalid: "Coinbase publishes no BTC-USD daily candle for that date, and Kraken's BTC/USD daily close is also unavailable by November 3, 2026 00:00 UTC.",
        ambiguity: "The first close Coinbase publishes counts. Later revisions and other exchanges don't, except Kraken as the stated fallback.",
      },
      source: { name: "Coinbase Exchange BTC-USD daily candles", url: "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400" },
      resolvesAt: "2026-11-01T00:00:00.000Z",
    },
  },
  {
    key: "house",
    favourite: HOUSE_FAV,
    cover: "midterm-cover.jpg",
    closeTime: "2026-11-03T23:00:00.000Z",
    summary: "Yes if the Associated Press projects a Democratic House majority by Nov 5, 23:59 UTC.",
    rationale: "The biggest event of the year, with a clear and quick answer from the AP race call.",
    metadata: {
      v: 1,
      question: "Will AP call the US House for Democrats by November 5, 2026 (UTC)?",
      category: "other",
      description: "The 2026 US midterm elections are on November 3. Control of the House needs 218 of 435 seats. Trading closes before polls close.",
      rules: {
        yes: "By November 5, 2026 23:59 UTC, the Associated Press projects that Democrats will win a majority (218 or more seats) of the US House.",
        no: "By then AP has projected a Republican majority, or AP has made no call for either party.",
        invalid: "AP's call is withdrawn or reversed before resolution, or the election is postponed.",
        ambiguity: "Only AP's projection counts. Network calls and later certified results don't change the outcome.",
      },
      source: { name: "Associated Press election results", url: "https://apnews.com/hub/election-2026" },
      resolvesAt: "2026-11-05T23:59:00.000Z",
    },
  },
];

const client = createPublicClient({ transport: http(RPC, { retryCount: 5, retryDelay: 800 }) });
const dir = mkdtempSync(path.join(tmpdir(), "mezonk-demo-"));
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
process.on("SIGINT", () => process.exit(130));

function askHidden(q: string): Promise<string> {
  const mute = new Writable({ write: (_c, _e, cb) => cb() });
  const rl = createInterface({ input: process.stdin, output: mute, terminal: true });
  process.stdout.write(q);
  return new Promise((res) => rl.question("", (a) => (rl.close(), process.stdout.write("\n"), res(a))));
}

interface Signer { name: string; pwFile: string; address: Address }
async function signer(name: string): Promise<Signer> {
  const pwFile = path.join(dir, `${name}.pw`);
  writeFileSync(pwFile, await askHidden(`Password for keystore "${name}": `), { mode: 0o600 });
  const address = cast(["wallet", "address", "--account", name, "--password-file", pwFile]).trim() as Address;
  return { name, pwFile, address };
}
const auth = (s: Signer) => ["--account", s.name, "--password-file", s.pwFile];

function cast(args: string[]): string {
  return execFileSync("cast", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

async function send(s: Signer, to: Address, data: Hex, label: string) {
  let hash: Hex;
  try {
    hash = cast(["send", to, data, ...auth(s), "--rpc-url", RPC, "--async"]).trim() as Hex;
  } catch (e) {
    const msg = (e as { stderr?: string }).stderr || (e as Error).message;
    throw new Error(`${label} failed: ${msg.trim().split("\n").slice(-3).join(" ")}`);
  }
  // The public RPC sometimes serves a lagging node that returns null receipts; poll by hash until it's mined.
  const r = await client.waitForTransactionReceipt({ hash, pollingInterval: 2000, timeout: 180_000, retryCount: 20 });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`  ✓ ${label} (${hash.slice(0, 12)}…)`);
  return r;
}

/** Signs in to the app (SIWE) and returns the session token, sent back as a Bearer header (the app's script path). */
async function signIn(s: Signer): Promise<string> {
  const n = await (await fetch(`${APP}/api/auth/nonce?wallet=${s.address}`, { cache: "no-store" })).json();
  const signature = cast(["wallet", "sign", ...auth(s), n.message]).trim() as Hex;
  if ((await recoverMessageAddress({ message: n.message, signature })).toLowerCase() !== s.address.toLowerCase()) throw new Error("sign-in signature mismatch");
  const r = await fetch(`${APP}/api/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: s.address, nonce: n.nonce, issuedAt: n.issuedAt, signature }),
  });
  if (!r.ok) throw new Error(`sign-in failed for ${s.name}: ${await r.text()}`);
  // Cookie-authenticated writes must come from the site's own origin; scripts use the token as a Bearer header.
  const token = (r.headers.get("set-cookie") ?? "").split(";")[0]?.split("=").slice(1).join("=") ?? "";
  if (!token) throw new Error("sign-in returned no session token");
  console.log(`  ✓ signed in ${s.name} (${s.address})`);
  return token;
}

async function api<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${APP}${url}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }), ...(init.headers ?? {}) },
  });
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${url}: ${body?.error?.message ?? r.status}${body?.error?.details ? ` ${JSON.stringify(body.error.details)}` : ""}`);
  return body as T;
}

async function uploadCover(cookie: string, file: string): Promise<string | null> {
  try {
    const fd = new FormData();
    fd.set("kind", "cover");
    fd.set("file", new Blob([readFileSync(path.join(COVERS, file))], { type: "image/jpeg" }), file);
    const r = await api<{ id: string }>(cookie, "/api/media", { method: "POST", body: fd });
    console.log(`  ✓ uploaded ${file}`);
    return r.id;
  } catch (e) {
    console.log(`  ! cover ${file} not uploaded (${(e as Error).message}). Continuing without it.`);
    return null;
  }
}

async function btcFavourite(): Promise<Side> {
  const r = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker");
  const price = Number((await r.json()).price);
  if (!Number.isFinite(price)) throw new Error("couldn't read BTC price from Coinbase; set it by hand");
  const fav: Side = price > 85_000 ? "yes" : "no";
  console.log(`  BTC is $${price.toLocaleString("en-US")} now, so ${fav === "yes" ? "Yes" : "No"} is the favourite`);
  return fav;
}

/** The creator's resting buy quantity (original size) per "outcome:price" on one market. */
async function creatorRestingByPrice(maker: Address, marketId: bigint): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const n = await client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "restingCount" });
  for (let i = 1n; i <= n; i++) {
    const o = await client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "getResting", args: [i] });
    if (o.marketId !== marketId || o.maker.toLowerCase() !== maker.toLowerCase() || o.side !== BUY) continue;
    const k = `${o.outcome}:${o.price}`;
    out.set(k, (out.get(k) ?? 0n) + o.quantity);
  }
  return out;
}

/** Market id created with this approval nonce, read from the factory's MarketApprovalUsed event. */
async function marketForApproval(nonce: Hex): Promise<bigint> {
  const head = await client.getBlockNumber();
  for (let to = head; to > head - 200_000n; to -= 9_999n) {
    const logs = await client.getContractEvents({ address: P.factoryAddress, abi: factoryAbi, eventName: "MarketApprovalUsed", fromBlock: to - 9_998n, toBlock: to });
    const hit = logs.find((l) => (l.args as { nonce?: Hex }).nonce?.toLowerCase() === nonce.toLowerCase());
    if (hit) return (hit.args as { marketId: bigint }).marketId;
  }
  throw new Error(`approval ${nonce} was used but its market wasn't found`);
}

async function main() {
  for (const [k, v] of [["FED_FAVOURITE", FED_FAV], ["HOUSE_FAVOURITE", HOUSE_FAV]] as const) {
    if (v !== "yes" && v !== "no") throw new Error(`Set ${k}=yes or ${k}=no (the side you think is more likely)`);
  }
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`RPC is chain ${chainId}, expected Mezo Testnet`);
  console.log(`Listing demo markets on ${APP} (Mezo Testnet)\n`);

  const curator = await signer(CURATOR);
  const creator = await signer(CREATOR);
  if (curator.address.toLowerCase() === creator.address.toLowerCase()) throw new Error("Curator and creator must be different wallets");
  if ((await client.getBalance({ address: curator.address })) < 10n ** 15n) throw new Error(`${curator.name} (${curator.address}) needs test BTC for gas: https://faucet.test.mezo.org/`);
  if ((await client.getBalance({ address: creator.address })) < 5n * 10n ** 14n) {
    // A fresh creator wallet has no gas: the curator sends it a little test BTC.
    cast(["send", creator.address, "--value", "0.002ether", ...auth(curator), "--rpc-url", RPC, "--json"]);
    console.log(`  ✓ sent 0.002 test BTC to the creator for gas`);
  }
  const f = { address: P.factoryAddress, abi: factoryAbi } as const;

  console.log("\nChecking roles and balances");
  const [isCurator, isCreator, owner] = await Promise.all([
    client.readContract({ ...f, functionName: "isCurator", args: [curator.address] }),
    client.readContract({ ...f, functionName: "isCreator", args: [creator.address] }),
    client.readContract({ ...f, functionName: "owner" }),
  ]);
  if (!isCurator) throw new Error(`${curator.address} is not an on-chain curator`);
  if (!isCreator) {
    if (owner.toLowerCase() !== curator.address.toLowerCase()) throw new Error(`${creator.address} isn't an approved creator and ${CURATOR} can't approve it`);
    await send(curator, P.factoryAddress, encodeFunctionData({ abi: factoryAbi, functionName: "setCreator", args: [creator.address, true] }), `approve ${creator.address} as creator`);
  } else console.log(`  ✓ ${creator.address} is an approved creator`);
  const resolver = ((await (await fetch(`${APP}/api/resolvers`)).json()).resolvers[0]?.address ?? "") as Address;
  if (!resolver) throw new Error("No approved resolver found");
  console.log(`  resolver: ${resolver}`);

  // Seeding: 20 shares at 85¢ + 20 at 8¢ = 18.6 MUSD per market. Ladder: LADDER shares at each ladder price. Keep a margin.
  const ladderCents = BigInt([...FAV_LADDER, ...LONG_LADDER].reduce((a, b) => a + b, 0));
  const need = (S(SHARES) * 93n / 100n + (S(LADDER) * ladderCents) / 100n) * BigInt(DEMOS.length) + S(5);
  const bal = await client.readContract({ address: MUSD, abi: erc20Abi, functionName: "balanceOf", args: [creator.address] });
  if (bal < need) {
    const top = need - bal;
    await send(curator, MUSD, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [creator.address, top] }), `send ${Number(top / 10n ** 16n) / 100} MUSD to creator for seeding`);
  } else console.log(`  ✓ creator has ${Number(bal / 10n ** 16n) / 100} MUSD`);
  const allowance = await client.readContract({ address: MUSD, abi: erc20Abi, functionName: "allowance", args: [creator.address, EXCHANGE] });
  if (allowance < need * 2n) await send(creator, MUSD, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [EXCHANGE, need * 4n] }), "let the exchange use the creator's MUSD");

  console.log("\nSigning in to the app");
  const creatorCookie = await signIn(creator);
  const curatorCookie = await signIn(curator);

  const done: string[] = [];
  const checklist = Object.fromEntries(REVIEW_CHECKLIST.map(([k]) => [k, true]));
  type Mine = { id: string; status: string; marketId: number | null; approval: StoredApproval | null; metadata: MarketMetadata };
  const mine = (await api<{ items: Mine[] }>(creatorCookie, "/api/proposals?mine=1&limit=100")).items;

  for (const d of DEMOS) {
    const raw = serializeMetadata(d.metadata);
    console.log(`\n${d.metadata.question}`);
    const fav: Side = d.favourite === "btc-spot" ? await btcFavourite() : d.favourite;
    // Resume: pick up an earlier run's proposal for this question instead of creating a duplicate.
    let p = mine.find((x) => x.metadata.question === d.metadata.question && !["rejected", "withdrawn"].includes(x.status));

    // 1. Suggest (creator is the author and, after review, the publisher)
    if (!p) {
      const coverMediaId = await uploadCover(creatorCookie, d.cover);
      const created = await api<{ id: string }>(creatorCookie, "/api/proposals", {
        method: "POST",
        body: JSON.stringify({
          metadata: d.metadata,
          outcomeType: "binary",
          projectId: null,
          closeTime: d.closeTime,
          launchWindow: "Today, for the testnet demo",
          liquidityPlan: `The creator seeds both sides: ${SHARES} shares on the favourite at 85¢ and ${SHARES} on the long shot at 8¢.`,
          conflicts: "None.",
          rationale: d.rationale,
          references: [],
          summary: d.summary,
          coverMediaId,
          contextMediaIds: [],
          sponsored: false,
        }),
      });
      p = { id: created.id, status: "draft", marketId: null, approval: null, metadata: d.metadata };
    }
    const id = p.id;
    if (p.status === "draft") {
      await api(creatorCookie, `/api/proposals/${id}/actions`, { method: "POST", body: JSON.stringify({ action: "submit" }) });
      p.status = "submitted";
      console.log(`  ✓ suggested (${APP}/proposals/${id})`);
    } else console.log(`  ✓ already suggested (${APP}/proposals/${id}), ${p.status}`);

    // 2. Review: claim, assign resolver + publisher, sign the exact approval the server builds, approve.
    if (p.status === "submitted" || p.status === "under_review") {
      if (p.status === "submitted") await api(curatorCookie, `/api/proposals/${id}/review`, { method: "POST", body: JSON.stringify({ action: "claim", reason: "", internal: false }) });
      await api(curatorCookie, `/api/proposals/${id}/review`, { method: "POST", body: JSON.stringify({ action: "assign", resolver, publisher: creator.address, reason: "" }) });
      const payload = await api<{ domain: { name: string; version: string; chainId: number; verifyingContract: Address }; approval: Omit<StoredApproval, "curator" | "signature"> }>(curatorCookie, `/api/proposals/${id}/approval`);
      const a = payload.approval;
      if (a.metadataHash.toLowerCase() !== metadataHash(raw).toLowerCase()) throw new Error("server's metadata hash differs from the local rules; stopping");
      if (Number(a.policyId) !== 2) console.log(`  ! approval binds policy #${a.policyId}, not the fast demo policy #2`);
      const message = { metadataHash: a.metadataHash, creator: a.creator, resolver: a.resolver, closeTime: Number(a.closeTime), policyId: Number(a.policyId), deadline: Number(a.deadline), nonce: a.nonce };
      const typed = {
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          ...approvalTypes,
        },
        primaryType: "MarketApproval",
        domain: payload.domain,
        message,
      };
      const typedFile = path.join(dir, `${d.key}.json`);
      writeFileSync(typedFile, JSON.stringify(typed));
      const signature = cast(["wallet", "sign", ...auth(curator), "--data", "--from-file", typedFile]).trim() as Hex;
      const signerAddr = await recoverTypedDataAddress({
        domain: payload.domain,
        types: approvalTypes,
        primaryType: "MarketApproval",
        message: { ...message, closeTime: BigInt(a.closeTime), deadline: BigInt(a.deadline) },
        signature,
      });
      if (signerAddr.toLowerCase() !== curator.address.toLowerCase()) throw new Error("approval signature doesn't recover to the curator");
      await api(curatorCookie, `/api/proposals/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ action: "approve", reason: "Demo market for the testnet review.", checklist, signature, approval: a, internal: false }),
      });
      p.status = "approved";
      p.approval = { ...a, curator: curator.address, signature };
      console.log(`  ✓ approved by curator (policy #${a.policyId})`);
    }

    // 3. Publish from the creator wallet with the curator's signed approval (skipped if it's already on-chain).
    let marketId = p.marketId != null ? BigInt(p.marketId) : null;
    if (marketId == null && p.approval) {
      const a = p.approval;
      const used = await client.readContract({ ...f, functionName: "approvalUsed", args: [a.nonce] });
      if (used) marketId = await marketForApproval(a.nonce);
      else {
        const r = await send(
          creator,
          P.factoryAddress,
          encodeFunctionData({
            abi: factoryAbi,
            functionName: "createMarket",
            args: [
              { metadata: raw, closeTime: BigInt(a.closeTime), resolver: a.resolver, policyId: Number(a.policyId) },
              { metadataHash: a.metadataHash, creator: a.creator, resolver: a.resolver, closeTime: BigInt(a.closeTime), policyId: Number(a.policyId), deadline: BigInt(a.deadline), nonce: a.nonce },
              a.curator,
              a.signature,
            ] as never,
          }),
          "publish",
        );
        const ev = parseEventLogs({ abi: exchangeAbi, logs: r.logs, eventName: "MarketCreated" })[0];
        if (!ev) throw new Error("publish confirmed but no MarketCreated event");
        marketId = ev.args.marketId as bigint;
      }
    }
    if (marketId == null) throw new Error(`proposal ${id} is ${p.status} with no approval to publish; open it on the site`);
    console.log(`  ✓ market #${marketId} on-chain`);

    // 4. Seed: buy the favourite at 85¢ (long shot buyable at 15¢) and the long shot at 8¢, then launch.
    const m = await client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "getMarket", args: [marketId] });
    if (m.graduatedAt > 0n) {
      console.log("  ✓ already live");
    } else {
      // Bid depth is YES bids; ask depth is NO bids (a NO bid at q is a YES ask at 100 − q). Only place what's missing.
      const ex = (fn: "placeOrder" | "graduate", args: readonly unknown[]) => encodeFunctionData({ abi: exchangeAbi, functionName: fn, args } as never);
      let g = await client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "graduationCheck", args: [marketId] });
      const want = S(SHARES);
      const orders: Array<[number, number, string]> = [
        [fav === "yes" ? YES : NO, 85, `buy ${fav === "yes" ? "Yes" : "No"} at 85¢ × ${SHARES}`],
        [fav === "yes" ? NO : YES, 8, `buy ${fav === "yes" ? "No" : "Yes"} at 8¢ × ${SHARES}`],
      ];
      for (const [outcome, price, label] of orders) {
        const have = outcome === YES ? g.bidDepth : g.askDepth;
        if (have >= want) console.log(`  ✓ already seeded: ${label}`);
        else await send(creator, EXCHANGE, ex("placeOrder", [marketId, outcome, BUY, price, want]), label);
      }
      g = await client.readContract({ address: EXCHANGE, abi: exchangeAbi, functionName: "graduationCheck", args: [marketId] });
      if (!(g.open && g.spreadOk && g.depthOk && g.seedersOk)) throw new Error(`market #${marketId} isn't ready to launch: ${JSON.stringify(g, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`);
      await send(creator, EXCHANGE, ex("graduate", [marketId]), "launch");
    }
    // 5. Depth: a small ladder on both sides so people can buy more than the 20 seed shares.
    if (LADDER > 0) {
      const ex = (args: readonly unknown[]) => encodeFunctionData({ abi: exchangeAbi, functionName: "placeOrder", args } as never);
      const mineAt = await creatorRestingByPrice(creator.address, marketId);
      const favOutcome = fav === "yes" ? YES : NO;
      const longOutcome = fav === "yes" ? NO : YES;
      for (const [outcome, prices] of [[favOutcome, FAV_LADDER], [longOutcome, LONG_LADDER]] as const) {
        for (const price of prices) {
          // Seed orders already sit at 85¢ and 8¢; the ladder adds LADDER on top, once.
          const base = price === 85 || price === 8 ? S(SHARES) : 0n;
          if ((mineAt.get(`${outcome}:${price}`) ?? 0n) >= base + S(LADDER)) continue;
          await send(creator, EXCHANGE, ex([marketId, outcome, BUY, price, S(LADDER)]), `depth: buy ${outcome === YES ? "Yes" : "No"} at ${price}¢ × ${LADDER}`);
        }
      }
    }
    void fetch(`${APP}/api/markets/${marketId}/refresh`, { method: "POST" }).catch(() => undefined);
    done.push(`#${marketId}  ${d.metadata.question}`);
  }

  console.log(`\nDone. Live markets:\n  ${done.join("\n  ")}\n\nThey appear on ${APP}/markets within a minute.`);
  console.log("Next: switch testnet back to normal (setPolicyActive 2 false, then the config restore).");
}

main().catch((e) => {
  console.error(`\nStopped: ${(e as Error).message}`);
  process.exit(1);
});
