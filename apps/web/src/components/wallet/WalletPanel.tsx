"use client";

import { useConnectModal } from "@rainbow-me/rainbowkit";
import { ArrowRight, ArrowUpRight, Check, Copy, LogOut, Repeat, Wallet } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useAccount, useBalance, useDisconnect, useReadContract } from "wagmi";
import { cx } from "@/components/ui/cx";
import { mezoBorrow, useMezoLoan } from "@/hooks/useMezoLoan";
import { deployment, explorerAddress, MEZO_TOKEN, TESTNET_FUNDING } from "@/lib/chain/config";
import { formatMusd, shortAddress } from "@/lib/format";

/** Up to 6 decimals, trailing zeros trimmed; "0" for nothing. */
const amount = (wei: bigint | undefined, max = 6) =>
  wei === undefined ? "—" : Number(formatUnits(wei, 18)).toLocaleString("en-US", { maximumFractionDigits: max });

/**
 * The connected wallet, as a dropdown from the header: which network the balances are on, every asset MEZONK cares
 * about (BTC, MEZO, MUSD) read live from that network, the user's Mezo loan if they have one, and wallet actions.
 * On testnet the balances are labelled as test tokens.
 */
export function WalletPanel({ address, musd, label }: { address: Address; musd: bigint | undefined; label: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const { connector } = useAccount();
  const { disconnect } = useDisconnect();
  const { openConnectModal } = useConnectModal();
  const btc = useBalance({ address, chainId: deployment.chainId, query: { enabled: open, refetchInterval: 15_000 } });
  const mezo = useReadContract({
    address: MEZO_TOKEN[deployment.chainId],
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    chainId: deployment.chainId,
    query: { enabled: open && !!MEZO_TOKEN[deployment.chainId], refetchInterval: 15_000 },
  });
  const loan = useMezoLoan();
  const trove = loan.trove.data;
  const price = loan.params.data?.price;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const testnet = !!deployment.chain.testnet;
  const explorer = explorerAddress(address);
  const ratio = trove?.active && price && trove.debt > 0n ? Number((trove.coll * price * 100n) / trove.debt / 10n ** 18n) : null;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Account ${label}`}
        className={cx(
          "inline-flex h-9 items-center gap-2 rounded-md border bg-surface px-3 text-sm font-semibold transition-colors",
          open ? "border-ink-2" : "border-line hover:border-ink-2",
        )}
      >
        {musd !== undefined && <span className="tnum hidden text-ink-2 sm:inline">{formatMusd(musd)} MUSD</span>}
        <span className="font-mono text-xs">{label}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Your wallet"
          className="fade absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-line bg-surface text-sm shadow-[var(--shadow-float)]"
        >
          <div className="flex items-center gap-3 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-2">
              <Wallet className="size-5 text-ink-2" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-muted">{connector?.name ?? "Wallet"}</p>
              <p className="mono truncate text-base font-medium">{shortAddress(address)}</p>
            </div>
            <button
              type="button"
              aria-label="Copy address"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(address);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } catch {
                  /* clipboard blocked */
                }
              }}
              className="press flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
            </button>
            {explorer && (
              <a href={explorer} target="_blank" rel="noreferrer" aria-label="View on explorer" className="flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink">
                <ArrowUpRight className="size-4" />
              </a>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="text-ink-2">Network</span>
            <span className="flex items-center gap-2 font-medium">
              <span aria-hidden className={cx("size-1.5 rounded-full", testnet ? "bg-warn" : "bg-success")} />
              {deployment.isLocalFork ? "Local fork" : deployment.chain.name}
            </span>
          </div>

          <div className="mx-3 rounded-md bg-sunk p-3">
            <p className="mb-1 flex justify-between text-ink-2">
              <span>In this wallet</span>
              {testnet && <span className="text-muted">Test tokens, no real value</span>}
            </p>
            <dl>
              {[
                ["BTC", amount(btc.data?.value)],
                ["MEZO", amount(mezo.data, 2)],
                ["MUSD", musd === undefined ? "—" : formatMusd(musd)],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between py-1.5">
                  <dt className="font-medium">{k}</dt>
                  <dd className="mono">{v}</dd>
                </div>
              ))}
            </dl>
          </div>

          <nav className="mt-2 border-t border-line" aria-label="Wallet shortcuts">
            <Link href="/portfolio" onClick={() => setOpen(false)} className="flex items-center justify-between px-4 py-3 hover:bg-surface-2">
              <span>
                <span className="block font-medium">Portfolio</span>
                <span className="text-muted">Positions, orders and history</span>
              </span>
              <ArrowRight className="size-4 text-ink-2" />
            </Link>
            {mezoBorrow && (
              <Link href="/borrow" onClick={() => setOpen(false)} className="flex items-center justify-between border-t border-line px-4 py-3 hover:bg-surface-2">
                <span>
                  <span className="block font-medium">{trove?.active ? "Your Mezo loan" : "Borrow MUSD"}</span>
                  <span className="text-muted">
                    {trove?.active
                      ? `Owes ${formatMusd(trove.debt)} MUSD${ratio != null ? ` · ratio ${ratio}%` : ""}`
                      : "Against your BTC, without selling it"}
                  </span>
                </span>
                <ArrowRight className="size-4 text-ink-2" />
              </Link>
            )}
            {testnet && !deployment.isLocalFork && (
              <a href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer" className="flex items-center justify-between border-t border-line px-4 py-3 hover:bg-surface-2">
                <span>
                  <span className="block font-medium">Get test BTC</span>
                  <span className="text-muted">Mezo faucet</span>
                </span>
                <ArrowUpRight className="size-4 text-ink-2" />
              </a>
            )}
          </nav>

          <div className="grid grid-cols-2 border-t border-line">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                disconnect(undefined, { onSettled: () => openConnectModal?.() });
              }}
              className="flex items-center justify-center gap-2 py-3 font-medium hover:bg-surface-2"
            >
              <Repeat className="size-4" /> Switch wallet
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                disconnect();
              }}
              className="flex items-center justify-center gap-2 border-l border-line py-3 font-medium hover:bg-surface-2"
            >
              <LogOut className="size-4" /> Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
