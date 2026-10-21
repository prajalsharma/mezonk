"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { explorerAddress, explorerTx } from "@/lib/chain/config";
import { shortAddress } from "@/lib/format";

/** Short address with copy and explorer link. Marks the connected wallet as "you". */
export function Address({ address, you, label }: { address: string; you?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const isYou = !!you && you.toLowerCase() === address.toLowerCase();
  return (
    <span className="inline-flex items-center gap-1.5 align-middle">
      {explorerAddress(address) ? (
        <a
          href={explorerAddress(address)!}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[0.8125rem] underline decoration-line underline-offset-2 hover:text-ink"
          title={address}
          aria-label={`${label ?? "Address"} ${address} on explorer`}
        >
          {shortAddress(address)}
        </a>
      ) : (
        <span className="font-mono text-[0.8125rem]" title={address}>{shortAddress(address)}</span>
      )}
      {isYou && <span className="text-xs font-semibold text-accent-text">you</span>}
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked */
          }
        }}
        aria-label={copied ? "Copied" : `Copy ${label ?? "address"}`}
        className="text-muted hover:text-ink"
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  );
}

/** A transaction reference. `label` replaces the shortened hash as the visible text (the full hash stays in the title). */
export function TxLink({ hash, label }: { hash: string; label?: string }) {
  const url = explorerTx(hash);
  const text = label ?? `${hash.slice(0, 10)}…${hash.slice(-6)}`;
  if (!url) return <span className={label ? "text-xs text-muted" : "font-mono text-xs text-ink-2"} title={`${hash} (local fork: no public explorer)`}>{text}</span>;
  return (
    <a href={url} target="_blank" rel="noreferrer" title={hash} className={`inline-flex items-center gap-1 text-xs text-ink-2 underline decoration-line underline-offset-2 hover:text-ink ${label ? "" : "font-mono"}`}>
      {text} <ExternalLink className="size-3" aria-hidden />
    </a>
  );
}
