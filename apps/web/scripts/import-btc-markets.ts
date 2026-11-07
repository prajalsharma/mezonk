/**
 * Monthly Bitcoin market import: finds the most traded Bitcoin price questions on Polymarket and Kalshi and lists
 * the same questions on MEZONK, settled on Mezo's own BTC price by MezonkPriceResolver, then seeds them.
 *
 * It goes through the normal governance path (suggest → curator review and EIP-712 approval → publish → seed),
 * so every market has a proposal page, a review trail and a curator signature. Only point-in-time "BTC at or above
 * $X at time T" questions are imported; see src/lib/import/btc.ts for what is skipped and why.
 *
 *   pnpm --filter web import:btc                         # plan only: fetch, rank, print, write the plan. No keys.
 *   IMPORT_PUBLISH=1 pnpm --filter web import:btc        # publish the plan (keystores: CURATOR_ACCOUNT, CREATOR_ACCOUNT)
 *
 * Unattended (a monthly cron job): IMPORT_CURATOR_KEY and IMPORT_CREATOR_KEY instead of keystores. The curator
 * must also own the price resolver (it records each market's strike). The creator must be a different wallet,
 * an approved creator, and hold the MUSD used for seeding. Every run also launches any earlier imported market
 * whose seeding has become complete. Testnet only. Full runbook: docs/BTC_IMPORT.md.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  http,
  isAddress,
  parseEventLogs,
  recoverMessageAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { protocolAddresses } from "../src/lib/chain/config";
import { laggingNodeFetch } from "../src/lib/chain/laggingNodeFetch";
import { exchangeAbi, factoryAbi, priceResolverAbi } from "../src/lib/contracts/abi";
import { approvalTypes, type StoredApproval } from "../src/lib/governance/approval";
import { REVIEW_CHECKLIST } from "../src/lib/governance/proposal";
import { buildMetadata, buildProposalExtras, seedPlan, select, utcMoment, type Candidate } from "../src/lib/import/btc";
import {
  DEFAULT_KALSHI_SERIES,
  fetchKalshiBitcoin,
  fetchPolymarketBitcoin,
  parseKalshiMarkets,
  parsePolymarketEvents,
  parseReferenceLabel,
  sourceName,
  type ExternalMarket,
} from "../src/lib/import/external";
import { metadataHash, serializeMetadata, type MarketMetadata } from "../src/lib/market/metadata";
import { loadSigner, type Signer } from "./lib/signer";

const env = (k: string, d: string) => process.env[k]?.trim() || d;
const APP = env("APP_URL", "https://www.mezonk.xyz");
const RPC = env("RPC_URL", "https://rpc.test.mezo.org");
const CHAIN_ID = 31611;
const EXCHANGE = getAddress(env("EXCHANGE", "0x4555cfF10200e1007435Cffc683C60683c5C49B9"));
const MUSD = getAddress("0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503");
const P = protocolAddresses(EXCHANGE);
const PUBLISH = process.env.IMPORT_PUBLISH === "1";
const LIMIT = Number(env("IMPORT_LIMIT", "3"));
const MAX_DAYS = Number(env("IMPORT_MAX_DAYS", "45"));
/** Trading time wanted after seeding ends, beyond the contract minimum. */
const MIN_TRADE_HOURS = Number(env("IMPORT_MIN_TRADE_HOURS", "24"));
const MIN_PROB = Number(env("IMPORT_MIN_PROB", "0.1"));
const MAX_PROB = Number(env("IMPORT_MAX_PROB", "0.9"));
const PER_MOMENT = Number(env("IMPORT_PER_MOMENT", "2"));
const SOURCES = env("IMPORT_SOURCES", "polymarket,kalshi").split(",").map((s) => s.trim());
const KALSHI_SERIES = env("IMPORT_KALSHI_SERIES", DEFAULT_KALSHI_SERIES.join(",")).split(",").map((s) => s.trim()).filter(Boolean);
const PLAN_FILE = env("IMPORT_PLAN_FILE", "btc-import-plan.json");
/** Optional saved API responses `{ "polymarket": <Gamma /events body>, "kalshi": <Kalshi /markets body> }` used instead of fetching. */
const SNAPSHOT = process.env.IMPORT_SNAPSHOT?.trim() || "";
const RESOLVER_ENV = process.env.PRICE_RESOLVER?.trim() || process.env.NEXT_PUBLIC_PRICE_RESOLVER?.trim() || "";
const DEFAULT_CAPTURE_MIN = 15;
const YES = 0, NO = 1, BUY = 0;
const WAD = 10n ** 18n;

const client = createPublicClient({ transport: http(RPC, { retryCount: 5, retryDelay: 800, fetchFn: laggingNodeFetch }) });
const ex = { address: EXCHANGE, abi: exchangeAbi } as const;
const fac = { address: P.factoryAddress, abi: factoryAbi } as const;
const musd = (v: bigint) => `${(Number(v / 10n ** 16n) / 100).toLocaleString("en-US")} MUSD`;
const pct = (p: number) => `${Math.round(p * 100)}%`;

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
  references?: Array<{ url: string; label: string }>;
};

/** Questions already on MEZONK (markets and live proposals), so a monthly run never lists one twice. */
async function existingQuestions(): Promise<Set<string>> {
  const out = new Set<string>();
  const markets = await api<{ items: Array<{ question: string }> }>(null, `/api/markets?${new URLSearchParams({ q: "Mezo's price feed", status: "all", limit: "100" })}`).catch(() => ({ items: [] }));
  for (const m of markets.items) out.add(m.question);
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
  candidate: Candidate;
  metadata: MarketMetadata;
  closeTime: string;
  seed: ReturnType<typeof seedPlan>;
  escrow: bigint;
}

async function plan() {
  const chainId = await client.getChainId();
  if (chainId !== CHAIN_ID) throw new Error(`RPC is chain ${chainId}, expected Mezo Testnet`);
  const [{ id: policyId, p: policy }, cfg, head] = await Promise.all([currentPolicy(), client.readContract({ ...fac, functionName: "config" }), client.getBlock()]);
  const resolver = RESOLVER_ENV && isAddress(RESOLVER_ENV) ? getAddress(RESOLVER_ENV) : null;
  const captureMin = resolver ? Math.round(Number(await client.readContract({ address: resolver, abi: priceResolverAbi, functionName: "captureWindow" })) / 60) : DEFAULT_CAPTURE_MIN;

  const now = Number(head.timestamp) * 1000;
  // Publishing starts seeding; the factory needs close ≥ publish + seeding period + minimum live time. Then some real trading time.
  const minClose = new Date(now + (policy.seedingPeriod + cfg.minLiveDuration + 600) * 1000 + MIN_TRADE_HOURS * 3_600_000);
  const maxClose = new Date(Math.min(now + MAX_DAYS * 86_400_000, now + cfg.maxDuration * 1000));

  console.log(`Policy #${policyId}: seeding ${policy.seedingPeriod / 3600}h, ${policy.minSeeders} seeder(s), depth ${Number(policy.minBidDepth / WAD)}/${Number(policy.minAskDepth / WAD)} shares, spread ≤ ${policy.maxSpread}¢`);
  console.log(`Looking for questions measured between ${utcMoment(minClose)} and ${utcMoment(maxClose)}\n`);

  const all: ExternalMarket[] = [];
  const errors: string[] = [];
  if (SNAPSHOT) {
    const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { polymarket?: unknown; kalshi?: unknown };
    if (SOURCES.includes("polymarket")) all.push(...parsePolymarketEvents(snap.polymarket ?? []).markets);
    if (SOURCES.includes("kalshi")) all.push(...parseKalshiMarkets(snap.kalshi ?? {}).markets);
    console.log(`Snapshot ${SNAPSHOT}: ${all.length} open Bitcoin markets`);
  } else if (SOURCES.includes("polymarket")) {
    try {
      const r = await fetchPolymarketBitcoin();
      all.push(...r.markets);
      console.log(`Polymarket: ${r.markets.length} open Bitcoin markets`);
    } catch (e) {
      errors.push(`Polymarket: ${(e as Error).message}`);
    }
  }
  if (!SNAPSHOT && SOURCES.includes("kalshi")) {
    const r = await fetchKalshiBitcoin(KALSHI_SERIES);
    all.push(...r.markets);
    errors.push(...r.errors);
    console.log(`Kalshi: ${r.markets.length} open Bitcoin markets (${KALSHI_SERIES.join(", ")})`);
  }
  for (const e of errors) console.log(`  ! ${e}`);
  if (!all.length) throw new Error("No markets fetched from any source");

  const sel = select(all, { minClose, maxClose, limit: LIMIT, perMoment: PER_MOMENT, minProb: MIN_PROB, maxProb: MAX_PROB, existingQuestions: await existingQuestions() }, captureMin);
  const reasons = new Map<string, number>();
  for (const s of sel.skipped) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  console.log(`\nSkipped ${sel.skipped.length}: ${[...reasons].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} ${r}`).join("; ") || "none"}`);

  const rows: PlanRow[] = sel.picked.map((c) => {
    const seed = seedPlan(c.probYes, {
      minBidDepth: Number(policy.minBidDepth / WAD),
      minAskDepth: Number(policy.minAskDepth / WAD),
      maxSpread: policy.maxSpread,
      minSeederNotional: Number(policy.minSeederNotional / WAD),
    });
    const escrow = (BigInt(seed.shares) * WAD * BigInt(seed.yesBid + seed.noBid)) / 100n;
    return { candidate: c, metadata: buildMetadata(c, captureMin), closeTime: c.market.evaluatesAt.toISOString(), seed, escrow };
  });

  console.log(`\nPicked ${rows.length}:`);
  for (const r of rows) {
    const c = r.candidate;
    console.log(`\n  ${r.metadata.question}`);
    console.log(`    from ${sourceName[c.market.source]}: "${c.market.title}"${c.market.label ? ` [${c.market.label}]` : ""}, Yes ${pct(c.probYes)}, 24h volume ${Math.round(c.market.volume24h).toLocaleString("en-US")}`);
    console.log(`    ${c.market.url}`);
    console.log(`    seed: Yes bid ${r.seed.yesBid}¢ and No bid ${r.seed.noBid}¢ (Yes ask ${100 - r.seed.noBid}¢) × ${r.seed.shares} shares = ${musd(r.escrow)} escrowed`);
  }
  const total = rows.reduce((a, r) => a + r.escrow, 0n);
  if (rows.length) console.log(`\nSeeding needs ${musd(total)} from the creator wallet.`);
  if (policy.minSeeders > 1) console.log(`Policy #${policyId} needs ${policy.minSeeders} distinct seeders: imported markets stay in seeding until others join, and launch on a later run.`);

  writeFileSync(
    PLAN_FILE,
    JSON.stringify({ at: new Date().toISOString(), policyId: Number(policyId), rows: rows.map((r) => ({ ...r, escrow: r.escrow.toString() })), skipped: sel.skipped.map((s) => ({ source: s.market.source, id: s.market.id, title: s.market.title, reason: s.reason })) }, null, 2),
  );
  console.log(`Plan written to ${PLAN_FILE}`);
  return { rows, policyId, policy, resolver, captureMin };
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
  if (m.graduatedAt > 0n) return log(`#${marketId} already live`);
  const g = await client.readContract({ ...ex, functionName: "graduationCheck", args: [marketId] });
  if (!g.open) return log(`#${marketId} seeding has ended without launching (refunds are open)`);
  if (!(g.spreadOk && g.depthOk && g.seedersOk)) return log(`#${marketId} still seeding (${g.seeders} seeder(s); depth ${g.depthOk ? "ok" : "short"}, spread ${g.spreadOk ? "ok" : "wide"})`);
  await send(creator, EXCHANGE, encodeFunctionData({ abi: exchangeAbi, functionName: "graduate", args: [marketId] }), `launch #${marketId}`);
}

async function publish(rows: PlanRow[], policyId: number, resolverAddr: Address | null) {
  if (!resolverAddr) throw new Error("Set PRICE_RESOLVER (the deployed MezonkPriceResolver) to publish. See docs/PRICE_RESOLVER.md.");
  const resolver = resolverAddr;
  const curator = await loadSigner("curator", "IMPORT_CURATOR_KEY", env("CURATOR_ACCOUNT", "deployer"));
  const creator = await loadSigner("creator", "IMPORT_CREATOR_KEY", env("CREATOR_ACCOUNT", "creator"));
  console.log(`\nCurator ${curator.address}, creator ${creator.address}`);
  if (curator.address === creator.address) throw new Error("Curator and creator must be different wallets (the factory rejects self-approval)");

  // Preconditions, all checked before anything is written.
  const [isCurator, isCreator, isResolver, resolverOwner, resolverExchange] = await Promise.all([
    client.readContract({ ...fac, functionName: "isCurator", args: [curator.address] }),
    client.readContract({ ...fac, functionName: "isCreator", args: [creator.address] }),
    client.readContract({ ...fac, functionName: "isResolver", args: [resolver] }),
    client.readContract({ address: resolver, abi: priceResolverAbi, functionName: "owner" }),
    client.readContract({ address: resolver, abi: priceResolverAbi, functionName: "exchange" }),
  ]);
  if (!isCurator) throw new Error(`${curator.address} is not an on-chain curator`);
  if (!isCreator) throw new Error(`${creator.address} is not an approved creator (owner: factory.setCreator)`);
  if (!isResolver) throw new Error(`${resolver} is not an allowlisted resolver (owner: factory.setResolver)`);
  if (getAddress(resolverExchange) !== EXCHANGE) throw new Error(`${resolver} belongs to a different exchange`);
  if (getAddress(resolverOwner) !== curator.address) throw new Error(`The price resolver is owned by ${resolverOwner}; the curator wallet must own it to record strikes`);
  for (const [who, s] of [["curator", curator], ["creator", creator]] as const) {
    if ((await client.getBalance({ address: s.address })) < 10n ** 15n) throw new Error(`${who} ${s.address} needs test BTC for gas: https://faucet.test.mezo.org/`);
  }
  const need = rows.reduce((a, r) => a + r.escrow, 0n);
  const bal = await client.readContract({ address: MUSD, abi: erc20Abi, functionName: "balanceOf", args: [creator.address] });
  if (bal < need) throw new Error(`The creator has ${musd(bal)} but seeding needs ${musd(need)}`);
  const allowance = await client.readContract({ address: MUSD, abi: erc20Abi, functionName: "allowance", args: [creator.address, EXCHANGE] });
  if (allowance < need) await send(creator, MUSD, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [EXCHANGE, need * 12n] }), "let the exchange use the creator's MUSD");

  const creatorToken = await signIn(creator);
  const curatorToken = await signIn(curator);
  const checklist = Object.fromEntries(REVIEW_CHECKLIST.map(([k]) => [k, true]));
  const mine = (await api<{ items: ProposalItem[] }>(creatorToken, "/api/proposals?mine=1&limit=100")).items;

  // Earlier imports whose seeding has since completed (e.g. other seeders joined): launch them.
  for (const p of mine) {
    if (p.marketId == null || !p.references?.some((r) => parseReferenceLabel(r.label))) continue;
    await launchIfReady(creator, BigInt(p.marketId), (s) => console.log(`  earlier import ${s}`)).catch((e) => console.log(`  earlier import #${p.marketId}: ${(e as Error).message}`));
  }

  const done: string[] = [];
  for (const r of rows) {
    const d = r.metadata;
    const raw = serializeMetadata(d);
    const c = r.candidate;
    const log = (s: string) => console.log(`    ${s}`);
    console.log(`\n  ${d.question}`);
    try {
      // 1. Suggest, or resume an earlier run's proposal for the same question.
      let p = mine.find((x) => x.metadata.question === d.question && !["rejected", "withdrawn"].includes(x.status));
      if (!p) {
        const extras = buildProposalExtras(c, new Date());
        const created = await api<{ id: string }>(creatorToken, "/api/proposals", {
          method: "POST",
          body: JSON.stringify({
            metadata: d,
            outcomeType: "binary",
            projectId: null,
            closeTime: r.closeTime,
            launchWindow: "Monthly Bitcoin import",
            ...extras,
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

      // 2. Review: claim, assign the price resolver and the creator as publisher, sign the server-built approval.
      if (p.status === "submitted" || p.status === "under_review") {
        if (p.status === "submitted") await api(curatorToken, `/api/proposals/${id}/review`, { method: "POST", body: JSON.stringify({ action: "claim", reason: "", internal: false }) });
        await api(curatorToken, `/api/proposals/${id}/review`, { method: "POST", body: JSON.stringify({ action: "assign", resolver, publisher: creator.address, reason: "" }) });
        const payload = await api<{ domain: { name: string; version: string; chainId: number; verifyingContract: Address }; approval: Omit<StoredApproval, "curator" | "signature"> }>(curatorToken, `/api/proposals/${id}/approval`);
        const a = payload.approval;
        // Sign only what this script built: same rules hash, resolver, publisher and close time.
        if (a.metadataHash.toLowerCase() !== metadataHash(raw).toLowerCase()) throw new Error("server's rules hash differs from the importer's");
        if (getAddress(a.resolver) !== resolver || getAddress(a.creator) !== creator.address) throw new Error("server's approval names a different resolver or publisher");
        if (Number(a.closeTime) * 1000 !== c.market.evaluatesAt.getTime()) throw new Error("server's approval has a different close time");
        if (Number(a.policyId) !== policyId) throw new Error(`server binds policy #${a.policyId}, the plan used #${policyId}; run again`);
        const message = { metadataHash: a.metadataHash, creator: a.creator, resolver: a.resolver, closeTime: BigInt(a.closeTime), policyId: Number(a.policyId), deadline: BigInt(a.deadline), nonce: a.nonce };
        const signature = await curator.signTypedData({ domain: payload.domain, types: approvalTypes, primaryType: "MarketApproval", message });
        const signer = await recoverTypedDataAddress({ domain: payload.domain, types: approvalTypes, primaryType: "MarketApproval", message, signature });
        if (getAddress(signer) !== curator.address) throw new Error("approval signature doesn't recover to the curator");
        await api(curatorToken, `/api/proposals/${id}/review`, {
          method: "POST",
          body: JSON.stringify({
            action: "approve",
            reason: `Imported from ${sourceName[c.market.source]} (${c.market.url}). Point-in-time BTC price question settled by Mezo's PriceFeed through the price resolver.`,
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

      // 4. Record the strike on the price resolver (once, before close).
      const [, , ruleSet] = await client.readContract({ address: resolver, abi: priceResolverAbi, functionName: "rules", args: [marketId] });
      if (!ruleSet) {
        await send(
          curator,
          resolver,
          encodeFunctionData({ abi: priceResolverAbi, functionName: "setRule", args: [marketId, BigInt(c.rule.strike) * WAD, c.rule.direction === "above" ? 0 : 1] }),
          `rule: ${c.rule.direction} $${c.rule.strike.toLocaleString("en-US")}`,
        );
      } else log("✓ rule already recorded");

      // 5. Seed both sides around the source's price; only what's missing, so a re-run doesn't double it.
      const g = await client.readContract({ ...ex, functionName: "graduationCheck", args: [marketId] });
      const want = BigInt(r.seed.shares) * WAD;
      for (const [outcome, price, have, label] of [
        [YES, r.seed.yesBid, g.bidDepth, `seed: buy Yes at ${r.seed.yesBid}¢ × ${r.seed.shares}`],
        [NO, r.seed.noBid, g.askDepth, `seed: buy No at ${r.seed.noBid}¢ × ${r.seed.shares}`],
      ] as const) {
        if (have >= want) log(`✓ already seeded: ${label}`);
        else await send(creator, EXCHANGE, encodeFunctionData({ abi: exchangeAbi, functionName: "placeOrder", args: [marketId, outcome, BUY, price, want - have] }), label);
      }

      // 6. Launch now if the policy is met; otherwise it stays in seeding for others to join.
      await launchIfReady(creator, marketId, log);
      void fetch(`${APP}/api/markets/${marketId}/refresh`, { method: "POST" }).catch(() => undefined);
      done.push(`#${marketId}  ${d.question}`);
    } catch (e) {
      // One bad market doesn't stop the batch; the next run resumes it.
      log(`! stopped on this market: ${(e as Error).message}`);
    }
  }
  console.log(`\nDone. ${done.length}/${rows.length} imported:\n  ${done.join("\n  ") || "(none)"}`);
}

async function main() {
  const { rows, policyId, resolver } = await plan();
  if (!PUBLISH) {
    console.log("\nPlan only. Run with IMPORT_PUBLISH=1 to list these on MEZONK.");
    return;
  }
  if (!rows.length) {
    console.log("\nNothing new to import this time.");
  }
  await publish(rows, Number(policyId), resolver);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(`\nStopped: ${(e as Error).message}`);
    process.exit(1);
  });
