"use client";

import { ExternalLink } from "lucide-react";
import { Spinner } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { explorerTx } from "@/lib/chain/config";
import { phaseText, type TxState } from "@/hooks/useTx";

/** Inline transaction progress. Lives in an aria-live region so state changes are announced. */
export function TxStatus({ state, onRetry }: { state: TxState; onRetry?: () => void }) {
  if (state.phase === "idle") return <div aria-live="polite" className="sr-only" />;
  const pending = ["validating", "awaiting-wallet", "confirming"].includes(state.phase);
  const failed = state.phase === "failed" || state.phase === "replaced";
  return (
    <div
      aria-live={failed ? "assertive" : "polite"}
      className={cx(
        "rounded-md border px-3 py-2.5 text-sm",
        failed ? "border-no/40 bg-no-soft" : state.phase === "confirmed" ? "border-yes/40 bg-yes-soft" : "border-line bg-surface-2",
      )}
    >
      <div className="flex items-center gap-2">
        {pending && <Spinner className="size-3.5" />}
        <span className="font-semibold">
          {state.label ? `${state.label}: ` : ""}
          {phaseText[state.phase]}
        </span>
      </div>
      {state.error && <p className="mt-1 text-ink-2">{state.error}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
        {state.hash && !explorerTx(state.hash) && <span className="font-mono text-xs text-ink-2">{state.hash.slice(0, 18)}…</span>}
        {state.hash && explorerTx(state.hash) && (
          <a
            href={explorerTx(state.hash)!}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-ink-2 underline decoration-line underline-offset-2 hover:text-ink"
          >
            View transaction <ExternalLink className="size-3" aria-hidden />
          </a>
        )}
        {failed && onRetry && (
          <button onClick={onRetry} className="font-semibold text-ink underline underline-offset-2">
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
