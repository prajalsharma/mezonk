"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Button } from "@/components/ui/Button";
import { WalletPanel } from "./WalletPanel";
import { useMusd } from "@/hooks/useMusd";
import { deployment } from "@/lib/chain/config";

export function WalletButton({ block = false }: { block?: boolean }) {
  const { balance } = useMusd();
  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openChainModal, mounted }) => {
        if (!mounted) return <span className="inline-block h-9 w-28" aria-hidden />;
        if (!account) {
          return (
            <Button size="sm" onClick={openConnectModal} className={block ? "w-full" : ""}>
              Connect wallet
            </Button>
          );
        }
        if (chain?.unsupported || chain?.id !== deployment.chainId) {
          return (
            <Button size="sm" variant="danger" onClick={openChainModal} className={block ? "w-full" : ""}>
              Switch to {deployment.chain.name}
            </Button>
          );
        }
        return <WalletPanel address={account.address as `0x${string}`} musd={balance} label={account.displayName} />;
      }}
    </ConnectButton.Custom>
  );
}
