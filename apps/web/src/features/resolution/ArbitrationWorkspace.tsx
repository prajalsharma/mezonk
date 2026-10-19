"use client";

import { AlertTriangle } from "lucide-react";
import { outcomeLabel } from "@/lib/market/stage";
import type { TimelineEntry } from "@/lib/market/timeline";
import { EvidenceBlock } from "./Timeline";
import type { DocState } from "./types";

/** Side-by-side proposal vs challenge, shown only to the market's arbitrator while a dispute is open. */
export function ArbitrationWorkspace({ timeline, documents }: { timeline: TimelineEntry[]; documents: Record<string, DocState> }) {
  const p = timeline.find((e) => e.kind === "proposed");
  const d = timeline.find((e) => e.kind === "disputed");
  const pDoc = p?.evidence ? documents[p.evidence.hash.toLowerCase()] : undefined;
  const dDoc = d?.evidence ? documents[d.evidence.hash.toLowerCase()] : undefined;
  const claimed = dDoc?.doc?.outcome;
  const pOutcome = p?.outcome;
  return (
    <section aria-labelledby="arb" className="space-y-3 rounded-lg border border-warn/50 bg-surface p-4">
      <h3 id="arb" className="text-base font-semibold">Arbitration workspace</h3>
      <p className="flex items-start gap-2 text-sm text-ink">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
        <span>
          Conflict: the resolver proposed <strong>{outcomeLabel(pOutcome)}</strong>; the challenger argues{" "}
          <strong>{claimed ? claimed[0]!.toUpperCase() + claimed.slice(1) : "a different outcome (not stated)"}</strong>. Decide only on
          the rules committed at creation and the evidence below.
        </span>
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="text-sm font-semibold">Proposal · {outcomeLabel(pOutcome)}</p>
          {p?.evidence ? <EvidenceBlock hash={p.evidence.hash} uri={p.evidence.uri} state={pDoc} /> : <p className="text-sm text-muted">No evidence indexed.</p>}
        </div>
        <div>
          <p className="text-sm font-semibold">Challenge</p>
          {d?.evidence ? <EvidenceBlock hash={d.evidence.hash} uri={d.evidence.uri} state={dDoc} /> : <p className="text-sm text-muted">No evidence indexed.</p>}
        </div>
      </div>
    </section>
  );
}
