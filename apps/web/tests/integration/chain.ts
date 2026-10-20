/**
 * Spins up a throwaway anvil chain (chain id 31611, no fork) and deploys MezonkMarkets with a
 * MockERC20 collateral from the Foundry build artifacts. Real EVM, real logs, real receipts.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTestClient, createWalletClient, http, publicActions, parseUnits, type Address, type Hash, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezonkMarketsAbi } from "@/lib/contracts/abi";
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
  curator: "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
} as const;
export type Who = keyof typeof KEYS;
export const E = (n: number) => parseUnits(String(n), 18);

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

  const token = artifact("MockERC20.sol", "MockERC20");
  const musd = await deploy(token.abi, token.bytecode.object, ["Mock MUSD", "MUSD"]);
  const mk = artifact("MezonkMarkets.sol", "MezonkMarkets");
  const deployBlock = (await client.getBlockNumber()) + 1n;
  const markets = await deploy(mk.abi, mk.bytecode.object, [
    musd,
    addr("owner"),
    {
      feeBps: 100,
      protocolFeeShareBps: 5000,
      minDuration: 3600,
      maxDuration: 365 * 86400,
      proposalWindow: 3 * 86400,
      challengeWindow: 86400,
      arbitrationWindow: 7 * 86400,
      minLiquidity: E(10),
      proposerBond: E(25),
      disputeBond: E(25),
      arbitrator: addr("arbitrator"),
    },
  ]);
  await send(wallet("owner").writeContract({ address: markets, abi: mezonkMarketsAbi, functionName: "setResolver", args: [addr("resolver"), true] }));
  await send(wallet("owner").writeContract({ address: markets, abi: mezonkMarketsAbi, functionName: "setCurator", args: [addr("curator"), true] }));
  await send(wallet("owner").writeContract({ address: markets, abi: mezonkMarketsAbi, functionName: "setCreator", args: [addr("creator"), true] }));
  for (const who of Object.keys(KEYS) as Who[]) {
    await send(wallet("owner").writeContract({ address: musd, abi: token.abi, functionName: "mint", args: [addr(who), E(1_000_000)] } as never));
    await send(wallet(who).writeContract({ address: musd, abi: token.abi, functionName: "approve", args: [markets, 2n ** 255n] } as never));
  }
  /** Publish a market as `creator` with a curator-signed approval (real EIP-712, real on-chain check). */
  const createMarket = async (p: CreateParams, creator: Who = "creator") => {
    const now = (await client.getBlock()).timestamp;
    const args = await signedCreateArgs(KEYS.curator, 31611, markets, addr(creator), p, now);
    await send(wallet(creator).writeContract({ address: markets, abi: mezonkMarketsAbi, functionName: "createMarket", args: args as never }));
    return client.readContract({ address: markets, abi: mezonkMarketsAbi, functionName: "marketCount" });
  };
  return { proc, rpc, client, wallet, addr, send, musd, markets, deployBlock, createMarket, stop: () => proc.kill() };
}
