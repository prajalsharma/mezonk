"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Button } from "@/components/ui/Button";
import { formatMusd } from "@/lib/format";
import { useMusd } from "@/hooks/useMusd";
import { deployment } from "@/lib/chain/config";

export function WalletButton({ block = false }: { block?: boolean }) {
  const { balance } = useMusd();
  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openAccountModal, openChainModal, mounted }) => {
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
        return (
          <button
            onClick={openAccountModal}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold hover:border-ink-2"
            aria-label={`Account ${account.displayName}`}
          >
            {balance !== undefined && (
              <span className="tnum hidden text-ink-2 sm:inline">{formatMusd(balance)} MUSD</span>
            )}
            <span className="font-mono text-xs">{account.displayName}</span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
