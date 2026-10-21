/**
 * Spins up a throwaway anvil chain (chain id 31611, no fork) and deploys MezonkExchange (which creates the
 * factory, resolution and incentives contracts) from the Foundry build artifacts. A MockERC20's code is placed
 * at the real configured MUSD address, so server code that reads `deployment.musd` works unmodified.
 * Real EVM, real logs, real receipts.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTestClient, createWalletClient, http, publicActions, parseUnits, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MUSD, protocolAddresses } from "@/lib/chain/config";
import { exchangeAbi, factoryAbi } from "@/lib/contracts/abi";
import { signedCreateArgs, type CreateParams } from "../../scripts/lib/approval-sign";

const OUT = path.resolve(__dirname, "../../../../contracts/out");
const artifact = (file: string, name: string) => JSON.parse(readFileSync(path.join(OUT, file, `${name}.json`), "utf8"));

export const KEYS = {
  owner: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  resolver: "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  arbitrator: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  creator: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  alice: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  bob: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  carol: "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  curator: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
} as const;
export type Who = keyof typeof KEYS;
export const E = (n: number) => parseUnits(String(n), 18);
export const YES = 0, NO = 1, BUY = 0, SELL = 1;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const TEST_POLICY = {
  minBidDepth: E(50),
  minAskDepth: E(50),
  minSeederNotional: E(10),
  minSeeders: 2,
  maxSpread: 10,
  band: 5,
  seedingPeriod: 3600,
  minRest: 60,
  takerFeeBps: 100,
  rebateShareBps: 2000,
  referralShareBps: 1000,
  rebatePeriod: 30 * 86400,
  claimWindow: 30 * 86400,
  rebateCapPerMarket: E(1000),
  rebateCapPerWallet: E(200),
  rebateBudget: E(10_000),
  referralCapPerMarket: E(50),
};

export async function startChain(port: number) {
  const rpc = `http://127.0.0.1:${port}`;
  const proc: ChildProcess = spawn("anvil", ["--port", String(port), "--chain-id", "31611", "--silent"], { stdio: "ignore" });
  const chain = { id: 31611, name: "anvil", nativeCurrency: { name: "BTC", symbol: "BTC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
  const client = createTestClient({ mode: "anvil", chain, transport: http(rpc) }).extend(publicActions);
  for (let i = 0; i < 100; i++) {
    try {
      await client.getBlockNumber();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  const wallet = (who: Who) => createWalletClient({ account: privateKeyToAccount(KEYS[who]), chain, transport: http(rpc) });
  const addr = (who: Who) => privateKeyToAccount(KEYS[who]).address;
  const send = async (p: Promise<Hash>) => {
    const r = await client.waitForTransactionReceipt({ hash: await p });
    if (r.status !== "success") throw new Error("reverted");
    return r;
  };
  const deploy = async (abi: unknown[], bytecode: Hex, args: unknown[]) => {
    const hash = await wallet("owner").deployContract({ abi, bytecode, args } as never);
    return (await client.waitForTransactionReceipt({ hash })).contractAddress as Address;
  };

  // Mock collateral at the real MUSD address for this chain id.
  const token = artifact("MockERC20.sol", "MockERC20");
  const musd = MUSD[31611]!;
  await client.setCode({ address: musd, bytecode: token.deployedBytecode.object });

  const exArt = artifact("MezonkExchange.sol", "MezonkExchange");
  const deployBlock = (await client.getBlockNumber()) + 1n;
  const exchange = await deploy(exArt.abi, exArt.bytecode.object, [
    musd,
    addr("owner"),
    {
      minLiveDuration: 3600,
      maxDuration: 365 * 86400,
      proposalWindow: 3 * 86400,
      challengeWindow: 86400,
      arbitrationWindow: 7 * 86400,
      proposerBond: E(25),
      disputeBond: E(25),
      arbitrator: addr("arbitrator"),
    },
  ]);
  const P = protocolAddresses(exchange);
  const f = { address: P.factoryAddress, abi: factoryAbi } as const;
  await send(wallet("owner").writeContract({ ...f, functionName: "setResolver", args: [addr("resolver"), true] }));
  await send(wallet("owner").writeContract({ ...f, functionName: "setCurator", args: [addr("curator"), true] }));
  await send(wallet("owner").writeContract({ ...f, functionName: "setCreator", args: [addr("creator"), true] }));
  await send(wallet("owner").writeContract({ address: exchange, abi: exchangeAbi, functionName: "addPolicy", args: [TEST_POLICY] }));
  for (const who of Object.keys(KEYS) as Who[]) {
    await send(wallet("owner").writeContract({ address: musd, abi: token.abi, functionName: "mint", args: [addr(who), E(1_000_000)] } as never));
    for (const spender of [exchange, P.resolutionAddress]) {
      await send(wallet(who).writeContract({ address: musd, abi: token.abi, functionName: "approve", args: [spender, 2n ** 255n] } as never));
    }
  }
  const ex = (who: Who, functionName: string, args: readonly unknown[]) =>
    send(wallet(who).writeContract({ address: exchange, abi: exchangeAbi, functionName, args } as never));

  /** Publish a market as `creator` with a curator-signed approval (real EIP-712, real on-chain check). */
  const createMarket = async (p: Omit<CreateParams, "policyId">, creator: Who = "creator") => {
    const now = (await client.getBlock()).timestamp;
    const args = await signedCreateArgs(KEYS.curator, 31611, P.factoryAddress, addr(creator), { ...p, policyId: 1 }, now);
    await send(wallet(creator).writeContract({ ...f, functionName: "createMarket", args: args as never }));
    return client.readContract({ address: exchange, abi: exchangeAbi, functionName: "marketCount" });
  };
  /** Two seeders, both sides: Yes bid 45 x 60 (alice) and Yes ask 55 (bob's No bid 45 x 60). Then graduate. */
  const seedAndGraduate = async (id: bigint) => {
    await ex("alice", "placeOrder", [id, YES, BUY, 45, E(60)]);
    await ex("bob", "placeOrder", [id, NO, BUY, 45, E(60)]);
    await ex("carol", "graduate", [id]);
  };
  const restingSources = (ids: bigint[]) =>
    ids.map((restingId) => ({
      restingId,
      order: { maker: ZERO, taker: ZERO, marketId: 0n, outcome: 0, side: 0, price: 0, quantity: 0n, expiry: 0n, nonce: 0n, salt: 0n },
      signature: "0x" as const,
    }));
  const take = async (who: Who, id: bigint, outcome: number, side: number, limit: number, qty: bigint, restingIds: bigint[]) => {
    const t = (await client.getBlock()).timestamp;
    return ex(who, "take", [{ marketId: id, outcome, side, limitPrice: limit, quantity: qty, minFill: 0n, deadline: t + 600n }, restingSources(restingIds)]);
  };
  return { proc, rpc, client, wallet, addr, send, ex, musd, exchange, ...P, deployBlock, createMarket, seedAndGraduate, take, stop: () => proc.kill() };
}
