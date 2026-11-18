/**
 * Monthly markets: each month MEZONK lists
 *   - Bitcoin price markets ("BTC at or above $X at time T"), settled on Mezo's own BTC price by MezonkPriceResolver;
 *   - two picks beyond Bitcoin, chosen at random from the most traded open questions, settled by a resolver from the
 *     official source named in their rules.
 * Questions are found on public prediction-market APIs; public text never names them (src/lib/import/*).
 *
 * Every market goes through the normal governance path (suggest → curator review and EIP-712 approval → publish →
 * seed), so each has a proposal page, a review trail and a curator signature.
 *
 *   pnpm --filter web import:markets                        # plan only: fetch, choose, print, write the plan. No keys.
 *   IMPORT_PUBLISH=1 pnpm --filter web import:markets       # publish (keystores: CURATOR_ACCOUNT, CREATOR_ACCOUNT)
 *
 * Every publish run also (1) launches earlier monthly markets whose seeding is complete and (2) proposes the outcome
 * of ended picks beyond Bitcoin once their result is known (needs the resolver wallet). Runbook: docs/MONTHLY_MARKETS.md.
 * Testnet only.
 */
import { randomInt } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  keccak256,
  parseEventLogs,
  recoverMessageAddress,
  recoverTypedDataAddress,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import { DEFAULT_DEPLOYMENT, MEZO_MAINNET_ID, MEZO_TESTNET_ID, MUSD as MUSD_BY_CHAIN, mezoMainnet, mezoTestnet, protocolAddresses } from "../src/lib/chain/config";
import { laggingNodeFetch } from "../src/lib/chain/laggingNodeFetch";
import { exchangeAbi, factoryAbi, priceResolverAbi, resolutionAbi } from "../src/lib/contracts/abi";
import { approvalTypes, type StoredApproval } from "../src/lib/governance/approval";
import { REVIEW_CHECKLIST } from "../src/lib/governance/proposal";
import { buildMetadata, buildProposalExtras, seedPlan, select, utcMoment, type BtcRule } from "../src/lib/import/btc";
import { eventProposalExtras, selectEvents } from "../src/lib/import/events";
import {
  DEFAULT_KALSHI_SERIES,
  fetchKalshiBitcoin,
  fetchPolymarketBitcoin,
  fetchPolymarketTop,
  fetchSourceResult,
  parseKalshiMarkets,
  parsePolymarketEvents,
  parseSourceTag,
  type ExternalMarket,
} from "../src/lib/import/external";
import { metadataHash, serializeMetadata, type MarketMetadata } from "../src/lib/market/metadata";
import { loadSigner, type Signer } from "./lib/signer";

const env = (k: string, d: string) => process.env[k]?.trim() || d;
/** IMPORT_CHAIN_ID 31611 (testnet, default) or 31612 (mainnet: also IMPORT_ALLOW_MAINNET=true, EXCHANGE and APP_URL). */
const CHAIN_ID = Number(env("IMPORT_CHAIN_ID", String(MEZO_TESTNET_ID)));
if (CHAIN_ID !== MEZO_TESTNET_ID && CHAIN_ID !== MEZO_MAINNET_ID) throw new Error(`IMPORT_CHAIN_ID ${CHAIN_ID} is not a Mezo network`);
const MAINNET = CHAIN_ID === MEZO_MAINNET_ID;
if (MAINNET && (process.env.IMPORT_ALLOW_MAINNET !== "true" || !process.env.EXCHANGE || !process.env.APP_URL)) {
  throw new Error("mainnet import needs IMPORT_ALLOW_MAINNET=true, EXCHANGE and APP_URL (the mainnet site)");
}
const CHAIN = MAINNET ? mezoMainnet : mezoTestnet;
const APP = env("APP_URL", "https://www.mezonk.xyz");
const RPC = env("RPC_URL", CHAIN.rpcUrls.default.http[0]!);
const EXCHANGE = getAddress(env("EXCHANGE", DEFAULT_DEPLOYMENT[CHAIN_ID]?.exchange ?? ""));
const MUSD = getAddress(MUSD_BY_CHAIN[CHAIN_ID]!);
const P = protocolAddresses(EXCHANGE);
const PUBLISH = process.env.IMPORT_PUBLISH === "1";
const BTC_LIMIT = Number(env("IMPORT_LIMIT", "3"));
const EVENTS = Number(env("IMPORT_EVENTS", "2"));
const EVENT_POOL = Number(env("IMPORT_EVENT_POOL", "20"));
const MAX_DAYS = Number(env("IMPORT_MAX_DAYS", "45"));
/** Trading time wanted after seeding ends, beyond the contract minimum. */
const MIN_TRADE_HOURS = Number(env("IMPORT_MIN_TRADE_HOURS", "24"));
const MIN_PROB = Number(env("IMPORT_MIN_PROB", "0.1"));
const MAX_PROB = Number(env("IMPORT_MAX_PROB", "0.9"));
const PER_MOMENT = Number(env("IMPORT_PER_MOMENT", "2"));
const SOURCES = env("IMPORT_SOURCES", "polymarket,kalshi").split(",").map((s) => s.trim());
const KALSHI_SERIES = env("IMPORT_KALSHI_SERIES", DEFAULT_KALSHI_SERIES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const PLAN_FILE = env("IMPORT_PLAN_FILE", "monthly-markets-plan.json");
/** Optional saved API responses `{ "polymarket": <events body>, "top": <events body>, "kalshi": <markets body> }` used instead of fetching. */
const SNAPSHOT = process.env.IMPORT_SNAPSHOT?.trim() || "";
const PRICE_RESOLVER_ENV = process.env.PRICE_RESOLVER?.trim() || process.env.NEXT_PUBLIC_PRICE_RESOLVER?.trim() || "";
const EVENT_RESOLVER_ENV = process.env.IMPORT_EVENT_RESOLVER?.trim() || "";
const DEFAULT_CAPTURE_MIN = 15;
const YES = 0, NO = 1, BUY = 0;
const WAD = 10n ** 18n;

const client = createPublicClient({ transport: http(RPC, { retryCount: 5, retryDelay: 800, fetchFn: laggingNodeFetch }) });
const ex = { address: EXCHANGE, abi: exchangeAbi } as const;
const fac = { address: P.factoryAddress, abi: factoryAbi } as const;
const musd = (v: bigint) => `${(Number(v / 10n ** 16n) / 100).toLocaleString("en-US")} MUSD`;
const pct = (p: number) => `${Math.round(p * 100)}%`;
const addr = (s: string) => (s && isAddress(s) ? getAddress(s) : null);

async function send(s: Signer, to: Address, data: Hex, label: string) {
  let hash: Hex;
  try {
    hash = await s.send(to, data, RPC);
  } catch (e) {
    throw new Error(`${label} failed: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`);
  }
  const r = await client.waitForTransactionReceipt({ hash, pollingInterval: 2000, timeout: 180_000, retryCount: 20 });
  if (r.status !== "success") throw new Error(`${label} reverted: ${hash}`);
  console.log(`    ✓ ${label} (${hash.slice(0, 12)}…)`);
  return r;
}

async function signIn(s: Signer): Promise<string> {
  const n = await (await fetch(`${APP}/api/auth/nonce?wallet=${s.address}`, { cache: "no-store" })).json();
  const signature = await s.signMessage(n.message);
  if ((await recoverMessageAddress({ message: n.message, signature })).toLowerCase() !== s.address.toLowerCase()) throw new Error("sign-in signature mismatch");
  const r = await fetch(`${APP}/api/auth/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ wallet: s.address, nonce: n.nonce, issuedAt: n.issuedAt, signature }),
  });
  if (!r.ok) throw new Error(`sign-in failed for ${s.label}: ${await r.text()}`);
  const token = (r.headers.get("set-cookie") ?? "").split(";")[0]?.split("=").slice(1).join("=") ?? "";
  if (!token) throw new Error("sign-in returned no session token");
  return token;
}

async function api<T>(token: string | null, url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${APP}${url}`, {
    ...init,
    cache: "no-store",
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const body = r.status === 204 ? null : await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${url}: ${body?.error?.message ?? r.status}${body?.error?.details ? ` ${JSON.stringify(body.error.details)}` : ""}`);
  return body as T;
}

type ProposalItem = {
  id: string;
  status: string;
  marketId: number | null;
  approval: StoredApproval | null;
  metadata: MarketMetadata;
  liquidityPlan?: string;
};

/** Questions already on MEZONK (markets and live proposals), so a monthly run never lists one twice. */
async function existingQuestions(): Promise<Set<string>> {
  const out = new Set<string>();
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await api<{ items: Array<{ question: string }> }>(null, `/api/markets?${new URLSearchParams({ status: "all", limit: "100", offset: String(offset) })}`).catch(() => ({ items: [] }));
    for (const m of r.items) out.add(m.question);
    if (r.items.length < 100) break;
  }
  const props = await api<{ items: ProposalItem[] }>(null, "/api/proposals?limit=100").catch(() => ({ items: [] }));
  for (const p of props.items) if (!["rejected", "withdrawn"].includes(p.status)) out.add(p.metadata.question);
  return out;
}

async function currentPolicy() {
  const count = await client.readContract({ ...ex, functionName: "policyCount" });
  for (let id = count; id >= 1; id--) {
    if (await client.readContract({ ...ex, functionName: "policyActive", args: [id] })) return { id, p: await client.readContract({ ...ex, functionName: "getPolicy", args: [id] }) };
  }
  throw new Error("No active market policy on-chain");
}

interface PlanRow {
  kind: "btc" | "event";
  market: ExternalMarket;
  metadata: MarketMetadata;
  probYes: number;
  rule: BtcRule | null;
  extras: ReturnType<typeof buildProposalExtras>;
  seed: ReturnType<typeof seedPlan>;
  escrow: bigint;
}

async function fetchAll() {
  const btc: ExternalMarket[] = [];
  const top: ExternalMarket[] = [];
  const errors: string[] = [];
  if (SNAPSHOT) {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { polymarket?: unknown; top?: unknown; kalshi?: unknown };
    if (SOURCES.includes("polymarket")) btc.push(...parsePolymarketEvents(snap.polymarket ?? []).markets);
    if (SOURCES.includes("kalshi")) btc.push(...parseKalshiMarkets(snap.kalshi ?? {}).markets);
    top.push(...parsePolymarketEvents(snap.top ?? []).markets);
    console.log(`Snapshot ${SNAPSHOT}: ${btc.length} Bitcoin markets, ${top.length} other open questions`);
    return { btc, top, errors };
  }
  if (SOURCES.includes("polymarket")) {
    try {
      btc.push(...(await fetchPolymarketBitcoin()).markets);
    } catch (e) {
      errors.push(`Bitcoin questions (source 1): ${(e as Error).message}`);
    }
    if (EVENTS > 0) {
      try {
        top.push(...(await fetchPolymarketTop()).markets);
      } catch (e) {
        errors.push(`Top questions: ${(e as Error).message}`);
      }
    }
  }
  if (SOURCES.includes("kalshi")) {
    const r = await fetchKalshiBitcoin(KALSHI_SERIES);
    btc.push(...r.markets);
    errors.push(...r.errors);
  }
  console.log(`Fetched ${btc.length} open Bitcoin markets and ${top.length} other open questions`);
  return { btc, top, errors };
}

async function plan() {
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`RPC is chain ${chainId}, expected ${CHAIN.name} (${CHAIN_ID})`);
  const [{ id: policyId, p: policy }, cfg, head] = await Promise.all([currentPolicy(), client.readContract({ ...fac, functionName: "config" }), client.getBlock()]);
  const priceResolver = addr(PRICE_RESOLVER_ENV);
  const captureMin = priceResolver ? Math.round(Number(await client.readContract({ address: priceResolver, abi: priceResolverAbi, functionName: "captureWindow" })) / 60) : DEFAULT_CAPTURE_MIN;

  const now = Number(head.timestamp) * 1000;
  // Publishing starts seeding; the factory needs close ≥ publish + seeding period + minimum live time. Then real trading time.
  const minClose = new Date(now + (policy.seedingPeriod + cfg.minLiveDuration + 600) * 1000 + MIN_TRADE_HOURS * 3_600_000);
  const maxClose = new Date(Math.min(now + MAX_DAYS * 86_400_000, now + cfg.maxDuration * 1000));
  console.log(`Policy #${policyId}: seeding ${policy.seedingPeriod / 3600}h, ${policy.minSeeders} seeder(s), depth ${Number(policy.minBidDepth / WAD)}/${Number(policy.minAskDepth / WAD)} shares, spread ≤ ${policy.maxSpread}¢`);
  console.log(`Questions must end between ${utcMoment(minClose)} and ${utcMoment(maxClose)}\n`);

  const { btc, top, errors } = await fetchAll();
  for (const e of errors) console.log(`  ! ${e}`);
  if (!btc.length && !top.length) throw new Error("No markets fetched from any source");
  const existing = await existingQuestions();

  const btcSel = select(btc, { minClose, maxClose, limit: BTC_LIMIT, perMoment: PER_MOMENT, minProb: MIN_PROB, maxProb: MAX_PROB, existingQuestions: existing }, captureMin);
  const evSel = selectEvents(top, { minClose, maxClose, count: EVENTS, pool: EVENT_POOL, minProb: MIN_PROB, maxProb: MAX_PROB, existingQuestions: existing, randomInt: (n) => randomInt(n) });
  for (const [name, skipped] of [["Bitcoin", btcSel.skipped], ["Beyond Bitcoin", evSel.skipped]] as const) {
    const reasons = new Map<string, number>();
    for (const s of skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
    console.log(`${name}: skipped ${skipped.length} (${[...reasons].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([r, n]) => `${n} ${r}`).join("; ") || "none"})`);
  }
  if (EVENTS > 0) console.log(`Beyond Bitcoin: drew ${evSel.picked.length} at random from the ${Math.min(EVENT_POOL, evSel.poolSize)} most traded that qualify`);

  const pol = {
    minBidDepth: Number(policy.minBidDepth / WAD),
    minAskDepth: Number(policy.minAskDepth / WAD),
    maxSpread: policy.maxSpread,
    minSeederNotional: Number(policy.minSeederNotional / WAD),
  };
  const row = (kind: PlanRow["kind"], market: ExternalMarket, metadata: MarketMetadata, probYes: number, rule: BtcRule | null, extras: PlanRow["extras"]): PlanRow => {
    const seed = seedPlan(probYes, pol);
    return { kind, market, metadata, probYes, rule, extras, seed, escrow: (BigInt(seed.shares) * WAD * BigInt(seed.yesBid + seed.noBid)) / 100n };
  };
  const at = new Date();
  const rows: PlanRow[] = [
    ...btcSel.picked.map((c) => row("btc", c.market, buildMetadata(c, captureMin), c.probYes, c.rule, buildProposalExtras(c, at))),
    ...evSel.picked.map((c) => row("event", c.market, c.metadata, c.probYes, null, eventProposalExtras(c, at))),
  ];

  console.log(`\nPicked ${rows.length}:`);
  for (const r of rows) {
    console.log(`\n  [${r.kind === "btc" ? "Bitcoin" : "pick"}] ${r.metadata.question}`);
    console.log(`    found at ${r.market.url} (Yes ${pct(r.probYes)}, 24h volume ${Math.round(r.market.volume24h).toLocaleString("en-US")})`);
    if (r.kind === "event") console.log(`    rule: ${r.metadata.rules.yes}\n    source: ${r.metadata.source.url}`);
    console.log(`    seed: Yes bid ${r.seed.yesBid}¢ and No bid ${r.seed.noBid}¢ (Yes ask ${100 - r.seed.noBid}¢) × ${r.seed.shares} shares = ${musd(r.escrow)}`);
  }
  if (rows.length) console.log(`\nSeeding needs ${musd(rows.reduce((a, r) => a + r.escrow, 0n))} from the creator wallet.`);
  if (policy.minSeeders > 1) console.log(`Policy #${policyId} needs ${policy.minSeeders} distinct seeders: new markets stay in seeding until others join, and launch on a later run.`);

  writeFileSync(
    PLAN_FILE,
    JSON.stringify(
      { at: at.toISOString(), policyId: Number(policyId), rows: rows.map((r) => ({ ...r, escrow: r.escrow.toString() })), skipped: [...btcSel.skipped, ...evSel.skipped].map((s) => ({ id: s.market.id, title: s.market.title, reason: s.reason })) },
      null,
      2,
    ),
  );
  console.log(`Plan written to ${PLAN_FILE}`);
  return { rows, policyId: Number(policyId), priceResolver };
}

/** Market id created with this approval nonce (from the factory's MarketApprovalUsed event). */
async function marketForApproval(nonce: Hex): Promise<bigint> {
  const head = await client.getBlockNumber();
  for (let to = head; to > head - 300_000n; to -= 9_999n) {
    const logs = await client.getContractEvents({ ...fac, eventName: "MarketApprovalUsed", args: { nonce }, fromBlock: to - 9_998n, toBlock: to });
    if (logs[0]) return logs[0].args.marketId as bigint;
  }
  throw new Error(`approval ${nonce} was used but its market wasn't found`);
}

async function launchIfReady(creator: Signer, marketId: bigint, log: (s: string) => void) {
  const m = await client.readContract({ ...ex, functionName: "getMarket", args: [marketId] });
  if (m.graduatedAt > 0n) return;
  const g = await client.readContract({ ...ex, functionName: "graduationCheck", args: [marketId] });
  if (!g.open) return;
  if (!(g.spreadOk && g.depthOk && g.seedersOk)) return log(`#${marketId} still seeding (${g.seeders} seeder(s); depth ${g.depthOk ? "ok" : "short"}, spread ${g.spreadOk ? "ok" : "wide"})`);
  await send(creator, EXCHANGE, encodeFunctionData({ abi: exchangeAbi, functionName: "graduate", args: [marketId] }), `launch #${marketId}`);
}

/**
 * Ended picks beyond Bitcoin: propose the outcome once the original question has a final result, citing the
 * official source in the rules. It's an ordinary proposal with a bond, so anyone can challenge it.
 */
async function proposeEnded(mine: ProposalItem[], eventResolver: Address) {
  const due: Array<{ p: ProposalItem; id: bigint; src: { source: "polymarket" | "kalshi"; id: string } }> = [];
  const resolution = await client.readContract({ ...ex, functionName: "resolution" });
  const now = (await client.getBlock()).timestamp;
  for (const p of mine) {
    const src = parseSourceTag(p.liquidityPlan);
    if (p.marketId == null || !src) continue;
    const id = BigInt(p.marketId);
    const m = await client.readContract({ ...ex, functionName: "getMarket", args: [id] });
    if (getAddress(m.resolver) !== eventResolver || m.graduatedAt === 0n || m.finalized) continue;
    if (now < m.closeTime || now >= m.closeTime + BigInt(m.proposalWindow)) continue;
    const stage = await client.readContract({ address: resolution, abi: resolutionAbi, functionName: "stageOf", args: [id] });
    if (stage === 1) due.push({ p, id, src }); // 1 = AwaitingProposal
  }
  if (!due.length) return;
  const resolver = await loadSigner("resolver", "IMPORT_RESOLVER_KEY", env("RESOLVER_ACCOUNT", "resolver"), CHAIN);
  if (resolver.address !== eventResolver) throw new Error(`the resolver key is ${resolver.address}, but these markets name ${eventResolver}`);
  for (const { p, id, src } of due) {
    const log = (s: string) => console.log(`  ended #${id}: ${s}`);
    try {
      const result = await fetchSourceResult(src.source, src.id);
      if (result === "pending") { log("no final result yet; will check again next run"); continue; }
      const m = await client.readContract({ ...ex, functionName: "getMarket", args: [id] });
      const allowance = await client.readContract({ address: MUSD, abi: erc20Abi, functionName: "allowance", args: [resolver.address, resolution] });
      if (allowance < m.proposerBond) await send(resolver, MUSD, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [resolution, m.proposerBond * 20n] }), "let resolution take proposer bonds");
      const evidence = { marketId: Number(id), question: p.metadata.question, outcome: result, source: p.metadata.source.url, checkedAt: new Date().toISOString() };
      await send(
        resolver,
        resolution,
        encodeFunctionData({ abi: resolutionAbi, functionName: "proposeOutcome", args: [id, result === "yes" ? 1 : 2, keccak256(toBytes(JSON.stringify(evidence))), p.metadata.source.url] }),
        `propose ${result === "yes" ? "Yes" : "No"} for #${id}`,
      );
    } catch (e) {
      log(`! ${(e as Error).message}`);
    }
  }
}

async function publish(rows: PlanRow[], policyId: number, priceResolver: Address | null) {
  const eventResolver = addr(EVENT_RESOLVER_ENV);
  if (rows.some((r) => r.kind === "btc") && !priceResolver) throw new Error("Set PRICE_RESOLVER (the deployed MezonkPriceResolver) to publish Bitcoin markets. See docs/PRICE_RESOLVER.md.");
  if (rows.some((r) => r.kind === "event") && !eventResolver) throw new Error("Set IMPORT_EVENT_RESOLVER (an allowlisted resolver wallet) to publish the picks beyond Bitcoin.");
  const curator = await loadSigner("curator", "IMPORT_CURATOR_KEY", env("CURATOR_ACCOUNT", "deployer"), CHAIN);
  const creator = await loadSigner("creator", "IMPORT_CREATOR_KEY", env("CREATOR_ACCOUNT", "creator"), CHAIN);
  console.log(`\nCurator ${curator.address}, creator ${creator.address}`);
  if (curator.address === creator.address) throw new Error("Curator and creator must be different wallets (the factory rejects self-approval)");

  // Preconditions, all checked before anything is written.
  const [isCurator, isCreator] = await Promise.all([
    client.readContract({ ...fac, functionName: "isCurator", args: [curator.address] }),
    client.readContract({ ...fac, functionName: "isCreator", args: [creator.address] }),
  ]);
  if (!isCurator) throw new Error(`${curator.address} is not an on-chain curator`);
  if (!isCreator) throw new Error(`${creator.address} is not an approved creator (owner: factory.setCreator)`);
  for (const r of [priceResolver, eventResolver]) {
    if (r && !(await client.readContract({ ...fac, functionName: "isResolver", args: [r] }))) throw new Error(`${r} is not an allowlisted resolver (owner: factory.setResolver)`);
  }
  if (priceResolver && rows.some((r) => r.kind === "btc")) {
    const [owner, exch] = await Promise.all([
      client.readContract({ address: priceResolver, abi: priceResolverAbi, functionName: "owner" }),
      client.readContract({ address: priceResolver, abi: priceResolverAbi, functionName: "exchange" }),
    ]);
    if (getAddress(exch) !== EXCHANGE) throw new Error(`${priceResolver} belongs to a different exchange`);
    if (getAddress(owner) !== curator.address) throw new Error(`The price resolver is owned by ${owner}; the curator wallet must own it to record strikes`);
  }
  for (const [who, s] of [["curator", curator], ["creator", creator]] as const) {
    if ((await client.getBalance({ address: s.address })) < 10n ** 15n) throw new Error(`${who} ${s.address} needs test BTC for gas: https://faucet.test.mezo.org/`);
  }
  const need = rows.reduce((a, r) => a + r.escrow, 0n);
  const bal = await client.readContract({ address: MUSD, abi: erc20Abi, functionName: "balanceOf", args: [creator.address] });
  if (bal < need) throw new Error(`The creator has ${musd(bal)} but seeding needs ${musd(need)}`);
  const allowance = await client.readContract({ address: MUSD, abi: erc20Abi, functionName: "allowance", args: [creator.address, EXCHANGE] });
  if (need > 0n && allowance < need) await send(creator, MUSD, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [EXCHANGE, need * 12n] }), "let the exchange use the creator's MUSD");

  const creatorToken = await signIn(creator);
  const mine = (await api<{ items: ProposalItem[] }>(creatorToken, "/api/proposals?mine=1&limit=100")).items;

  // Earlier monthly markets: launch the ones whose seeding is complete, propose outcomes for ended picks.
  for (const p of mine) {
    if (p.marketId == null || !parseSourceTag(p.liquidityPlan)) continue;
    await launchIfReady(creator, BigInt(p.marketId), (s) => console.log(`  earlier ${s}`)).catch((e) => console.log(`  earlier #${p.marketId}: ${(e as Error).message}`));
  }
  if (eventResolver) await proposeEnded(mine, eventResolver).catch((e) => console.log(`  proposing outcomes: ${(e as Error).message}`));
  if (!rows.length) return console.log("\nNo new markets this run.");

  const curatorToken = await signIn(curator);
  const checklist = Object.fromEntries(REVIEW_CHECKLIST.map(([k]) => [k, true]));
  const done: string[] = [];
  for (const r of rows) {
    const d = r.metadata;
    const raw = serializeMetadata(d);
    const resolver = (r.kind === "btc" ? priceResolver : eventResolver)!;
    const log = (s: string) => console.log(`    ${s}`);
    console.log(`\n  ${d.question}`);
    try {
      // 1. Suggest, or resume an earlier run's proposal for the same question.
      let p = mine.find((x) => x.metadata.question === d.question && !["rejected", "withdrawn"].includes(x.status));
      if (!p) {
        const created = await api<{ id: string }>(creatorToken, "/api/proposals", {
          method: "POST",
          body: JSON.stringify({
            metadata: d,
            outcomeType: "binary",
            projectId: null,
            closeTime: d.resolvesAt,
            launchWindow: "Monthly markets",
            ...r.extras,
            coverMediaId: null,
            contextMediaIds: [],
            sponsored: false,
          }),
        });
        p = { id: created.id, status: "draft", marketId: null, approval: null, metadata: d };
      }
      const id = p.id;
      if (p.status === "draft") {
        await api(creatorToken, `/api/proposals/${id}/actions`, { method: "POST", body: JSON.stringify({ action: "submit" }) });
        p.status = "submitted";
        log(`✓ suggested: ${APP}/proposals/${id}`);
      }

      // 2. Review: claim, assign resolver and publisher, sign the server-built approval after checking it.
      if (p.status === "submitted" || p.status === "under_review") {
        if (p.status === "submitted") await api(curatorToken, `/api/proposals/${id}/review`, { method: "POST", body: JSON.stringify({ action: "claim", reason: "", internal: false }) });
        await api(curatorToken, `/api/proposals/${id}/review`, { method: "POST", body: JSON.stringify({ action: "assign", resolver, publisher: creator.address, reason: "" }) });
        const payload = await api<{ domain: { name: string; version: string; chainId: number; verifyingContract: Address }; approval: Omit<StoredApproval, "curator" | "signature"> }>(curatorToken, `/api/proposals/${id}/approval`);
        const a = payload.approval;
        if (a.metadataHash.toLowerCase() !== metadataHash(raw).toLowerCase()) throw new Error("server's rules hash differs from the importer's");
        if (getAddress(a.resolver) !== resolver || getAddress(a.creator) !== creator.address) throw new Error("server's approval names a different resolver or publisher");
        if (Number(a.closeTime) * 1000 !== new Date(d.resolvesAt).getTime()) throw new Error("server's approval has a different close time");
        if (Number(a.policyId) !== policyId) throw new Error(`server binds policy #${a.policyId}, the plan used #${policyId}; run again`);
        const message = { metadataHash: a.metadataHash, creator: a.creator, resolver: a.resolver, closeTime: BigInt(a.closeTime), policyId: Number(a.policyId), deadline: BigInt(a.deadline), nonce: a.nonce };
        const signature = await curator.signTypedData({ domain: payload.domain, types: approvalTypes, primaryType: "MarketApproval", message });
        const signer = await recoverTypedDataAddress({ domain: payload.domain, types: approvalTypes, primaryType: "MarketApproval", message, signature });
        if (getAddress(signer) !== curator.address) throw new Error("approval signature doesn't recover to the curator");
        await api(curatorToken, `/api/proposals/${id}/review`, {
          method: "POST",
          body: JSON.stringify({
            action: "approve",
            reason:
              r.kind === "btc"
                ? "Monthly Bitcoin market. Point-in-time BTC price question settled by Mezo's PriceFeed through the price resolver."
                : `Monthly pick beyond Bitcoin. Rules passed the automated checks; resolves from ${d.source.name}.`,
            checklist,
            signature,
            approval: a,
            internal: false,
          }),
        });
        p.status = "approved";
        p.approval = { ...a, curator: curator.address, signature };
        log(`✓ approved (policy #${a.policyId})`);
      }

      // 3. Publish from the creator wallet.
      let marketId = p.marketId != null ? BigInt(p.marketId) : null;
      if (marketId == null && p.approval) {
        const a = p.approval;
        if (await client.readContract({ ...fac, functionName: "approvalUsed", args: [a.nonce] })) marketId = await marketForApproval(a.nonce);
        else {
          const rc = await send(
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
          const ev = parseEventLogs({ abi: exchangeAbi, logs: rc.logs, eventName: "MarketCreated" })[0];
          if (!ev) throw new Error("publish confirmed but no MarketCreated event");
          marketId = ev.args.marketId as bigint;
        }
      }
      if (marketId == null) throw new Error(`proposal ${id} is ${p.status}; open ${APP}/proposals/${id}`);
      log(`✓ market #${marketId} on-chain`);

      // 4. Bitcoin markets: record the strike on the price resolver (once, before close).
      if (r.rule && priceResolver) {
        const [, , ruleSet] = await client.readContract({ address: priceResolver, abi: priceResolverAbi, functionName: "rules", args: [marketId] });
        if (!ruleSet) {
          await send(
            curator,
            priceResolver,
            encodeFunctionData({ abi: priceResolverAbi, functionName: "setRule", args: [marketId, BigInt(r.rule.strike) * WAD, r.rule.direction === "above" ? 0 : 1] }),
            `rule: ${r.rule.direction} $${r.rule.strike.toLocaleString("en-US")}`,
          );
        }
      }

      // 5. Seed both sides around the found price; only what's missing, so a re-run doesn't double it.
      const g = await client.readContract({ ...ex, functionName: "graduationCheck", args: [marketId] });
      const want = BigInt(r.seed.shares) * WAD;
      for (const [outcome, price, have, label] of [
        [YES, r.seed.yesBid, g.bidDepth, `seed: buy Yes at ${r.seed.yesBid}¢ × ${r.seed.shares}`],
        [NO, r.seed.noBid, g.askDepth, `seed: buy No at ${r.seed.noBid}¢ × ${r.seed.shares}`],
      ] as const) {
        if (have < want) await send(creator, EXCHANGE, encodeFunctionData({ abi: exchangeAbi, functionName: "placeOrder", args: [marketId, outcome, BUY, price, want - have] }), label);
      }

      // 6. Launch now if the policy is met; otherwise it waits in seeding for others to join.
      await launchIfReady(creator, marketId, log);
      void fetch(`${APP}/api/markets/${marketId}/refresh`, { method: "POST" }).catch(() => undefined);
      done.push(`#${marketId}  ${d.question}`);
    } catch (e) {
      // One bad market doesn't stop the batch; the next run resumes it.
      log(`! stopped on this market: ${(e as Error).message}`);
    }
  }
  console.log(`\nDone. ${done.length}/${rows.length} listed:\n  ${done.join("\n  ") || "(none)"}`);
}

async function main() {
  const { rows, policyId, priceResolver } = await plan();
  if (!PUBLISH) return console.log("\nPlan only. Run with IMPORT_PUBLISH=1 to list these on MEZONK.");
  await publish(rows, policyId, priceResolver);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\nStopped: ${(e as Error).message}`);
    process.exit(1);
  });
