"use client";

import { CheckCircle2, CircleDashed, AlertTriangle, ExternalLink, Link2 } from "lucide-react";
import { Address, TxLink } from "@/components/ui/Address";
import { cx } from "@/components/ui/cx";
import { formatDateTime } from "@/lib/format";
import type { TimelineEntry } from "@/lib/market/timeline";
import type { DocState } from "./types";

/** Safe outbound link: https only, hostname shown, no referrer, marked as user content. */
export function SafeLink({ url, label }: { url: string; label?: string }) {
  let host = "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") throw new Error();
    host = u.hostname;
  } catch {
    return <span className="break-all font-mono text-xs text-muted" title="Not an https link, not linked">{url}</span>;
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer nofollow ugc" className="inline-flex max-w-full items-center gap-1 underline decoration-line underline-offset-2 hover:text-ink">
      <span className="truncate">{label || host}</span>
      {label && <span className="shrink-0 text-xs text-muted">({host})</span>}
      <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

export function EvidenceBlock({ hash, uri, state }: { hash: string; uri: string; state?: DocState }) {
  return (
    <div className="mt-2 space-y-2 rounded-md border border-line bg-sunk p-3 text-sm">
      {state?.status === "verified" && state.doc ? (
        <>
          <p className="flex items-center gap-1.5 text-xs text-yes">
            <CheckCircle2 className="size-3.5" aria-hidden /> Document matches the hash committed on-chain
          </p>
          <p className="whitespace-pre-wrap break-words text-ink">{state.doc.summary}</p>
          <ul className="space-y-1">
            {state.doc.links.map((l, i) => (
              <li key={i} className="space-y-0.5">
                <SafeLink url={l.url} label={l.label} />
                {l.sha256 && <p className="break-all font-mono text-[11px] text-muted">sha256 (claimed by submitter): {l.sha256}</p>}
              </li>
            ))}
          </ul>
        </>
      ) : state?.status === "mismatch" ? (
        <p className="flex items-center gap-1.5 text-no">
          <AlertTriangle className="size-3.5" aria-hidden /> The stored document does not match the on-chain hash. Do not rely on it.
        </p>
      ) : (
        <p className="text-ink-2">
          The evidence document for this hash isn&apos;t stored by MEZONK. The submitter&apos;s reference is below; check it yourself against the hash.
        </p>
      )}
      <p className="break-all font-mono text-[11px] text-muted">hash {hash}</p>
      {uri && (
        <p className="flex items-start gap-1 text-xs text-ink-2">
          <Link2 className="mt-0.5 size-3 shrink-0" aria-hidden />
          <span className="min-w-0 break-all">On-chain reference: <SafeLink url={uri} /></span>
        </p>
      )}
    </div>
  );
}

export function Timeline({ entries, documents, you }: { entries: TimelineEntry[]; documents: Record<string, DocState>; you?: string }) {
  return (
    <ol className="relative space-y-0">
      {entries.map((e, i) => {
        const Icon = e.status === "done" ? CheckCircle2 : e.status === "lapsed" ? AlertTriangle : CircleDashed;
        const tone = e.status === "done" ? "text-ink" : e.status === "lapsed" ? "text-warn" : "text-muted";
        const last = i === entries.length - 1;
        return (
          <li key={`${e.kind}-${i}`} className="relative grid grid-cols-[1.25rem_1fr] gap-x-3 pb-5">
            {!last && <span aria-hidden className="absolute left-[0.6rem] top-5 h-[calc(100%-1rem)] w-px bg-line" />}
            <Icon className={cx("relative mt-0.5 size-5 bg-bg", tone)} aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <p className={cx("font-semibold", e.status === "pending" && "text-ink-2")}>
                  {e.title}
                  <span className="sr-only">. Status: {e.status}.</span>
                </p>
                <time dateTime={e.at} className="text-xs text-muted">{formatDateTime(new Date(e.at))}</time>
              </div>
              {e.detail && <p className="text-sm text-ink-2">{e.detail}</p>}
              {e.deadline && (
                <p className="text-sm text-ink-2">
                  Deadline <time dateTime={e.deadline}>{formatDateTime(new Date(e.deadline))}</time>
                </p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                <span>{e.source === "chain" ? "On-chain event" : "From contract parameters"}</span>
                {e.actor && <Address address={e.actor} you={you} label="Actor" />}
                {e.txHash && <TxLink hash={e.txHash} />}
              </div>
              {e.evidence && <EvidenceBlock hash={e.evidence.hash} uri={e.evidence.uri} state={documents[e.evidence.hash.toLowerCase()]} />}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
