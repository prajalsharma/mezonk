"use client";

import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  okxWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { deployment } from "@/lib/chain/config";

const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const wallets = projectId
  ? [metaMaskWallet, rabbyWallet, okxWallet, coinbaseWallet, walletConnectWallet, injectedWallet]
  : [injectedWallet, metaMaskWallet, rabbyWallet, coinbaseWallet];

const connectors = connectorsForWallets([{ groupName: "Wallets", wallets }], {
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
