import { defineChain, getAddress, getContractAddress, isAddress, type Address, type Chain } from "viem";

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

/**
 * MEZONK's own deployment per network, used when NEXT_PUBLIC_MARKETS_ADDRESS isn't set. Testnet deployed by the owner on
 * 2026-10-22 (verified on-chain: code present, factory and owner as expected). Never add mainnet here without sign-off.
 */
export const DEFAULT_DEPLOYMENT: Record<number, { exchange: Address; deployBlock: bigint }> = {
  [MEZO_TESTNET_ID]: { exchange: "0x4555cfF10200e1007435Cffc683C60683c5C49B9", deployBlock: 16298919n },
};

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
  chain: Chain;
  chainId: number;
  rpcUrl: string;
  isLocalFork: boolean;
  /** MezonkExchange (env NEXT_PUBLIC_MARKETS_ADDRESS). Holds collateral, shares, orders. */
  marketsAddress: Address | null;
  /** Created by the exchange constructor (contract nonces 1, 2, 3), so derived rather than configured. */
  resolutionAddress: Address | null;
  factoryAddress: Address | null;
  incentivesAddress: Address | null;
  deployBlock: bigint;
  musd: Address;
  explorer: string;
  ready: boolean;
  reason: ReadinessReason;
}

function readDeployment(): Deployment {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? MEZO_TESTNET_ID);
  const rpcOverride = process.env.NEXT_PUBLIC_RPC_URL;
  const baseChain = chainId === MEZO_MAINNET_ID ? mezoMainnet : mezoTestnet;
  // With an RPC override (private provider or local fork), wallets and connectors must use it too.
  const chain: Chain = rpcOverride ? { ...baseChain, rpcUrls: { default: { http: [rpcOverride] } } } : baseChain;
  const rpcUrl = rpcOverride || baseChain.rpcUrls.default.http[0]!;
  const isLocalFork = !!rpcOverride && /localhost|127\.0\.0\.1/.test(rpcOverride);
  // A local fork always configures its own address (dev-chain.sh); public networks fall back to the known deployment.
  const fallback = rpcOverride ? undefined : DEFAULT_DEPLOYMENT[chainId];
  const rawAddress = process.env.NEXT_PUBLIC_MARKETS_ADDRESS || fallback?.exchange || "";
  const base = {
    chain,
    chainId,
    rpcUrl,
    isLocalFork,
    deployBlock: process.env.NEXT_PUBLIC_MARKETS_DEPLOY_BLOCK
      ? BigInt(process.env.NEXT_PUBLIC_MARKETS_DEPLOY_BLOCK)
      : !process.env.NEXT_PUBLIC_MARKETS_ADDRESS && !rpcOverride
        ? (DEFAULT_DEPLOYMENT[chainId]?.deployBlock ?? 0n)
        : 0n,
    musd: MUSD[chainId] ?? MUSD[MEZO_TESTNET_ID]!,
    explorer: baseChain.blockExplorers.default.url,
  };

  const none = { marketsAddress: null, resolutionAddress: null, factoryAddress: null, incentivesAddress: null };
  if (chainId !== MEZO_TESTNET_ID && chainId !== MEZO_MAINNET_ID) {
    return { ...base, ...none, ready: false, reason: "unsupported-chain" };
  }
  if (chainId === MEZO_MAINNET_ID && process.env.NEXT_PUBLIC_ENABLE_MAINNET !== "true") {
    return { ...base, ...none, ready: false, reason: "mainnet-disabled" };
  }
  if (!rawAddress) return { ...base, ...none, ready: false, reason: "no-deployment" };
  if (!isAddress(rawAddress)) return { ...base, ...none, ready: false, reason: "invalid-address" };
  const ex = getAddress(rawAddress);
  return { ...base, ...protocolAddresses(ex), ready: true, reason: "ok" };
}

/**
 * The exchange constructor deploys MezonkResolution, MezonkMarketFactory and MezonkIncentives in that order,
 * so their addresses are CREATE addresses of the exchange at nonces 1, 2, 3. /api/health confirms them on-chain.
 */
export function protocolAddresses(exchange: Address) {
  return {
    marketsAddress: exchange,
    resolutionAddress: getContractAddress({ from: exchange, nonce: 1n }),
    factoryAddress: getContractAddress({ from: exchange, nonce: 2n }),
    incentivesAddress: getContractAddress({ from: exchange, nonce: 3n }),
  };
}

export const deployment = readDeployment();

export const readinessMessage: Record<ReadinessReason, string> = {
  ok: "Connected to the deployed market contract.",
  "unsupported-chain": "This build is configured for an unsupported network. Trading is off.",
  "no-deployment": "The market contract is not deployed on this network yet. Trading is off.",
  "invalid-address": "The configured market contract address is malformed. Trading is off.",
  "mainnet-disabled": "Mainnet trading is not enabled. Use Mezo Testnet.",
};

/**
 * Explorer links exist only for a verified public network. On a local fork the public explorer
 * doesn't know these transactions, so links are suppressed (null) and hashes render as text.
 */
export const hasExplorer = deployment.ready && !deployment.isLocalFork;
export const explorerTx = (hash: string): string | null => (hasExplorer ? `${deployment.explorer}/tx/${hash}` : null);
export const explorerAddress = (addr: string): string | null =>
  hasExplorer ? `${deployment.explorer}/address/${addr}` : null;

/** Official routes to testnet funds (verified 2026-10-19). */
/** Where to borrow MUSD against BTC. Testnet page verified; on mainnet we link the Mezo home page rather than guess a path. */
export const mezoBorrowUrl = () => (deployment.chain.testnet ? TESTNET_FUNDING.borrowMusd : "https://mezo.org");

export const TESTNET_FUNDING = {
  btcFaucet: "https://faucet.test.mezo.org/",
  borrowMusd: "https://testnet.mezo.org/feature/borrow",
  minBorrowNote: "Mezo requires a minimum MUSD debt of 1,800 plus a 200 MUSD gas deposit.",
} as const;
