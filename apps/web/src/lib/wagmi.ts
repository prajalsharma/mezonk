"use client";

import { connectorsForWallets, type Wallet } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, createConnector, http } from "wagmi";
import { mock } from "@wagmi/core";
import type { Address } from "viem";
import { deployment } from "@/lib/chain/config";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

// Browser-extension wallets (MetaMask, Rabby, OKX…) are discovered through EIP-6963 by injectedWallet.
// MetaMask's SDK-based connector is only added with WalletConnect (mobile deep links); it sends SDK analytics.
const wallets = projectId
  ? [injectedWallet, metaMaskWallet, rabbyWallet, okxWallet, coinbaseWallet, walletConnectWallet]
  : [injectedWallet, rabbyWallet, coinbaseWallet];

/**
 * Local end-to-end test wallets: anvil's public test accounts, signing through the local node.
 * Enabled only when NEXT_PUBLIC_E2E_WALLET=anvil AND the RPC is localhost. Never in real builds.
 */
export const E2E_ACCOUNTS: Record<string, Address> = {
  owner: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  resolver: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  arbitrator: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  creator: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
  alice: "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
  bob: "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
  carol: "0x976EA74026E726554dB657fA54763abd0C3a0aa9",
};
export const e2eEnabled = process.env.NEXT_PUBLIC_E2E_WALLET === "anvil" && deployment.isLocalFork;

const testWallet = (role: string, account: Address): (() => Wallet) => () => ({
  id: `e2e-${role}`,
  name: `Test wallet: ${role}`,
  iconUrl: "/mezonk-icon.svg",
  iconBackground: "#14110F",
  createConnector: (details) =>
    createConnector((config) => ({
      ...mock({ accounts: [account], features: { reconnect: true } })(config),
      ...details,
    })),
});

const groups = [{ groupName: "Wallets", wallets }];
if (e2eEnabled) {
  groups.unshift({
    groupName: "Local test wallets",
    wallets: Object.entries(E2E_ACCOUNTS).map(([r, a]) => testWallet(r, a)) as typeof wallets,
  });
}

const connectors = connectorsForWallets(groups, {
  appName: "MEZONK",
  // WalletConnect-based wallets are only listed when a project id is configured.
  projectId: projectId ?? "unset",
});

export const wagmiConfig = createConfig({
  chains: [deployment.chain],
  connectors,
  transports: { [deployment.chain.id]: http(deployment.rpcUrl) } as Record<number, ReturnType<typeof http>>,
  ssr: true,
});
