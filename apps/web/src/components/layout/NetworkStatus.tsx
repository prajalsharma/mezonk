"use client";

import { Check, ChevronDown } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Status } from "@/components/ui/primitives";
import { cx } from "@/components/ui/cx";
import { useHealth } from "@/hooks/useHealth";
import { deployment, isMainnet, NETWORK_SITES } from "@/lib/chain/config";

/**
 * Dot + network name, and a switch between Mezo Mainnet and the testnet practice site. Each network is its own
 * deployment, so switching is a link to the same page on the other site; a site that isn't configured shows as
 * "coming soon" instead of a dead link. The dot colour and tooltip carry the health
 * state; the banner below the header explains problems.
 */
export function NetworkStatus({ compact = false }: { compact?: boolean }) {
  const { data, isLoading, isError } = useHealth();
  const short = isMainnet ? "Mainnet" : "Testnet";
  const name = deployment.isLocalFork ? "Local fork" : compact ? short : deployment.chain.name;
  let tone: "yes" | "warn" | "no" | "muted" = "muted";
  let text = name;
  let title = "Checking network status";
  if (isError) {
    tone = "no";
    text = compact ? "Offline" : "Data service offline";
    title = "The MEZONK API is unreachable. On-chain state is unaffected.";
  } else if (data && !isLoading) {
    if (!data.rpc.ok) {
      tone = "no";
      text = compact ? "RPC down" : `${name} · RPC unreachable`;
      title = "The Mezo RPC did not respond.";
    } else if (!data.chain.ready) {
      tone = "warn";
      title = data.chain.message;
    } else if (!data.indexer || data.indexer.stale) {
      tone = "warn";
      title = "Indexed data is behind the chain. Balances and trades shown from the chain are still live.";
    } else {
      tone = "yes";
      title = `Block ${data.rpc.blockNumber} · indexer ${data.indexer.lagBlocks ?? 0} blocks behind`;
    }
  }

  const other = isMainnet ? NETWORK_SITES.testnet : NETWORK_SITES.mainnet;
  if (deployment.isLocalFork) {
    return (
      <span title={title} className="whitespace-nowrap">
        <Status tone={tone}>{text}</Status>
      </span>
    );
  }
  return <Switcher tone={tone} text={text} title={title} other={other} compact={compact} />;
}

const SHARED_PATHS = new Set(["/", "/markets", "/btc", "/borrow", "/portfolio", "/suggest", "/discover", "/activity", "/status"]);

function Switcher({ tone, text, title, other, compact }: { tone: "yes" | "warn" | "no" | "muted"; text: string; title: string; other: string | null; compact: boolean }) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  // Market ids, proposals and profiles differ per network; only keep paths that exist on both.
  const keep = SHARED_PATHS.has(path) || path.startsWith("/docs");
  const href = other ? `${other}${keep ? path : "/"}` : null;
  const items = [
    { key: "mainnet", label: "Mezo Mainnet", note: "Real BTC and MUSD", current: isMainnet },
    { key: "testnet", label: "Mezo Testnet", note: "Free test funds", current: !isMainnet },
  ];
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        className={cx("press inline-flex h-9 items-center gap-1 whitespace-nowrap rounded-md hover:bg-surface-2", compact ? "px-1.5" : "px-2")}
      >
        <Status tone={tone}>{text}</Status>
        <ChevronDown className={cx("size-3.5 text-muted transition-transform", open && "rotate-180", compact && "max-[379px]:hidden")} aria-hidden />
      </button>
      {open && (
        <div role="menu" aria-label="Network" className="glass fade absolute right-0 top-11 z-[var(--z-dropdown)] w-60 overflow-hidden rounded-lg border p-1.5 shadow-3">
          {items.map((it) =>
            it.current ? (
              <div key={it.key} role="menuitemradio" aria-checked="true" className="flex items-center justify-between rounded-sm px-3 py-2 text-sm">
                <span>
                  <span className="block font-medium">{it.label}</span>
                  <span className="block text-xs text-muted">{it.note}</span>
                </span>
                <Check className="size-4 text-yes-text" aria-label="Current network" />
              </div>
            ) : href ? (
              <a key={it.key} role="menuitemradio" aria-checked="false" href={href} className="block rounded-sm px-3 py-2 text-sm hover:bg-surface-2">
                <span className="block font-medium">{it.label}</span>
                <span className="block text-xs text-muted">{it.note}</span>
              </a>
            ) : (
              <div key={it.key} role="menuitemradio" aria-checked="false" aria-disabled="true" className="rounded-sm px-3 py-2 text-sm text-muted">
                <span className="block font-medium">{it.label}</span>
                <span className="block text-xs">Practice site coming soon</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
