import { defineChain, getAddress, isAddress, type Address } from "viem";

/**
 * Single source of truth for networks, tokens and protocol deployments.
 * Facts verified 2026-10-19 against mezo.org/docs and live RPC calls (see docs/initial-audit.md).
 */

export const MEZO_TESTNET_ID = 31611;
export const MEZO_MAINNET_ID = 31612;

export const mezoTestnet = defineChain({
  id: MEZO_TESTNET_ID,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.test.mezo.org"], webSocket: ["wss://rpc-ws.test.mezo.org"] },
  },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
  testnet: true,
});

export const mezoMainnet = defineChain({
  id: MEZO_MAINNET_ID,
  name: "Mezo",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  // No official mezo.org endpoint exists; these are providers listed in the Mezo docs.
  rpcUrls: { default: { http: ["https://mezo-mainnet.boar.network", "https://mezo.drpc.org"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.mezo.org" } },
});

/** Verified MUSD deployments. Never resolve a token by symbol. */
export const MUSD: Record<number, Address> = {
  [MEZO_TESTNET_ID]: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  [MEZO_MAINNET_ID]: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
};
export const MUSD_DECIMALS = 18;

/** MEZO token (precompile-style address). Not used for any protocol function yet. */
export const MEZO_TOKEN: Record<number, Address> = {
  [MEZO_TESTNET_ID]: "0x7B7c000000000000000000000000000000000001",
  [MEZO_MAINNET_ID]: "0x7B7c000000000000000000000000000000000001",
};

/** Public RPC rejects getLogs ranges of 10,000 blocks or more. */
export const LOG_RANGE_LIMIT = 9_999n;

export type ReadinessReason =
  | "ok"
  | "unsupported-chain"
  | "no-deployment"
  | "invalid-address"
  | "mainnet-disabled";

export interface Deployment {
  chain: typeof mezoTestnet | typeof mezoMainnet;
  chainId: number;
  rpcUrl: string;
  isLocalFork: boolean;
  marketsAddress: Address | null;
  deployBlock: bigint;
  musd: Address;
  explorer: string;
  ready: boolean;
  reason: ReadinessReason;
}

function readDeployment(): Deployment {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? MEZO_TESTNET_ID);
  const chain = chainId === MEZO_MAINNET_ID ? mezoMainnet : mezoTestnet;
  const rpcOverride = process.env.NEXT_PUBLIC_RPC_URL;
  const rpcUrl = rpcOverride || chain.rpcUrls.default.http[0]!;
  const isLocalFork = !!rpcOverride && /localhost|127\.0\.0\.1/.test(rpcOverride);
  const rawAddress = process.env.NEXT_PUBLIC_MARKETS_ADDRESS ?? "";
  const base = {
    chain,
    chainId,
    rpcUrl,
    isLocalFork,
    deployBlock: BigInt(process.env.NEXT_PUBLIC_MARKETS_DEPLOY_BLOCK || "0"),
    musd: MUSD[chainId] ?? MUSD[MEZO_TESTNET_ID]!,
    explorer: chain.blockExplorers.default.url,
  };

  if (chainId !== MEZO_TESTNET_ID && chainId !== MEZO_MAINNET_ID) {
    return { ...base, marketsAddress: null, ready: false, reason: "unsupported-chain" };
  }
  if (chainId === MEZO_MAINNET_ID && process.env.NEXT_PUBLIC_ENABLE_MAINNET !== "true") {
    return { ...base, marketsAddress: null, ready: false, reason: "mainnet-disabled" };
  }
  if (!rawAddress) return { ...base, marketsAddress: null, ready: false, reason: "no-deployment" };
  if (!isAddress(rawAddress)) return { ...base, marketsAddress: null, ready: false, reason: "invalid-address" };
  return { ...base, marketsAddress: getAddress(rawAddress), ready: true, reason: "ok" };
}

export const deployment = readDeployment();

export const readinessMessage: Record<ReadinessReason, string> = {
  ok: "Connected to the deployed market contract.",
  "unsupported-chain": "This build is configured for an unsupported network. Trading is off.",
  "no-deployment": "The market contract is not deployed on this network yet. Trading is off.",
  "invalid-address": "The configured market contract address is malformed. Trading is off.",
  "mainnet-disabled": "Mainnet trading is not enabled. Use Mezo Testnet.",
};

export const explorerTx = (hash: string) => `${deployment.explorer}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${deployment.explorer}/address/${addr}`;

/** Official routes to testnet funds (verified 2026-10-19). */
export const TESTNET_FUNDING = {
  btcFaucet: "https://faucet.test.mezo.org/",
  borrowMusd: "https://testnet.mezo.org/feature/borrow",
  minBorrowNote: "Mezo requires a minimum MUSD debt of 1,800 plus a 200 MUSD gas deposit.",
} as const;
