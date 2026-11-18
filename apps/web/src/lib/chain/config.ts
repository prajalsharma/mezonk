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
  name: "Mezo Mainnet",
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
 * MEZONK's own deployment per network, used when NEXT_PUBLIC_MARKETS_ADDRESS isn't set. Both deployed by the owner
 * (wallet 0x017FF5FB886E90f9e5ADb405D8eFddffC1162dD2) and verified on-chain: code present, owner, factory and MUSD
 * collateral as expected. Testnet 2026-10-22; mainnet 2026-11-18 (deploy block from the transaction receipt).
 */
export const DEFAULT_DEPLOYMENT: Record<number, { exchange: Address; deployBlock: bigint; btcRounds?: Address; priceResolver?: Address }> = {
  [MEZO_TESTNET_ID]: { exchange: "0x4555cfF10200e1007435Cffc683C60683c5C49B9", deployBlock: 16298919n },
  [MEZO_MAINNET_ID]: {
    exchange: "0x102C908dCA719742f1958D18021B7C1c0092Ddf0",
    deployBlock: 13301975n,
    btcRounds: "0xc27f434195e4aF70782817A280A5D3Cb5de2ECa8",
    priceResolver: "0xc58D8A13B1e6f1614508ca20124A9d0F60520354",
  },
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
  /** MezonkPriceResolver (env NEXT_PUBLIC_PRICE_RESOLVER): settles BTC-price markets from Mezo's PriceFeed. Optional. */
  priceResolverAddress: Address | null;
  /** MezonkBtcRounds (env NEXT_PUBLIC_BTC_ROUNDS): BTC up/down rounds staked in native BTC. Optional. */
  btcRoundsAddress: Address | null;
  deployBlock: bigint;
  musd: Address;
  explorer: string;
  ready: boolean;
  reason: ReadinessReason;
}

function optionalAddress(env: string | undefined, fallback: Address | undefined): Address | null {
  if (env && isAddress(env)) return getAddress(env);
  return fallback ?? null;
}

function readDeployment(): Deployment {
  // Mainnet is the product; the testnet practice site and local forks set NEXT_PUBLIC_CHAIN_ID=31611.
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || MEZO_MAINNET_ID);
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
    priceResolverAddress: optionalAddress(process.env.NEXT_PUBLIC_PRICE_RESOLVER, fallback?.priceResolver),
    btcRoundsAddress: optionalAddress(process.env.NEXT_PUBLIC_BTC_ROUNDS, fallback?.btcRounds),
  };

  const none = { marketsAddress: null, resolutionAddress: null, factoryAddress: null, incentivesAddress: null };
  if (chainId !== MEZO_TESTNET_ID && chainId !== MEZO_MAINNET_ID) {
    return { ...base, ...none, ready: false, reason: "unsupported-chain" };
  }
  // Owner-authorized 2026-11-18. NEXT_PUBLIC_ENABLE_MAINNET=false switches mainnet trading off again.
  if (chainId === MEZO_MAINNET_ID && process.env.NEXT_PUBLIC_ENABLE_MAINNET === "false") {
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

/** True on the real-money network. Copy that differs per network keys off this (or `deployment.chain.testnet`). */
export const isMainnet = deployment.chainId === MEZO_MAINNET_ID;

/**
 * Each network is its own deployment of this app (own build, database and indexer). The header switcher links
 * between them, keeping the current path. Unset → that network isn't offered.
 */
export const NETWORK_SITES: { mainnet: string | null; testnet: string | null } = {
  mainnet: process.env.NEXT_PUBLIC_MAINNET_URL?.replace(/\/+$/, "") || "https://www.mezonk.xyz",
  testnet: process.env.NEXT_PUBLIC_TESTNET_URL?.replace(/\/+$/, "") || null,
};

export const readinessMessage: Record<ReadinessReason, string> = {
  ok: "Connected to the deployed market contract.",
  "unsupported-chain": "This build is configured for an unsupported network. Trading is off.",
  "no-deployment": "The market contract is not deployed on this network yet. Trading is off.",
  "invalid-address": "The configured market contract address is malformed. Trading is off.",
  "mainnet-disabled": "Mainnet trading isn't switched on yet. You can try everything on Mezo Testnet.",
};

/**
 * Explorer links exist only for a verified public network. On a local fork the public explorer
 * doesn't know these transactions, so links are suppressed (null) and hashes render as text.
 */
export const hasExplorer = deployment.ready && !deployment.isLocalFork;
export const explorerTx = (hash: string): string | null => (hasExplorer ? `${deployment.explorer}/tx/${hash}` : null);
export const explorerAddress = (addr: string): string | null =>
  hasExplorer ? `${deployment.explorer}/address/${addr}` : null;

/** Where to borrow MUSD against BTC. Testnet page verified; on mainnet we link the Mezo home page rather than guess a path. */
export const mezoBorrowUrl = () => (deployment.chain.testnet ? TESTNET_FUNDING.borrowMusd : "https://mezo.org/feature/borrow");

/** Official routes to testnet funds (verified 2026-10-19). */
export const TESTNET_FUNDING = {
  btcFaucet: "https://faucet.test.mezo.org/",
  borrowMusd: "https://testnet.mezo.org/feature/borrow",
  minBorrowNote: "Mezo requires a minimum MUSD debt of 1,800 plus a 200 MUSD gas deposit.",
} as const;
