import { CheckCircle2, ExternalLink, AlertTriangle } from "lucide-react";
import { metadataHash, type MarketMetadata } from "@/lib/market/metadata";
import { formatDateTime } from "@/lib/format";

/**
 * Resolution rules exactly as committed at creation. The hash shown is recomputed here from the
 * emitted metadata and compared with the hash stored in the contract.
 */
export function RulesPanel({
  meta,
  raw,
  onchainHash,
  closeTime,
}: {
  meta: MarketMetadata | null;
  raw: string;
  onchainHash: string;
  closeTime: Date;
}) {
  const matches = metadataHash(raw) === onchainHash;
  return (
    <section aria-labelledby="rules" className="space-y-4">
      <h2 id="rules" className="text-xl font-semibold">Resolution rules</h2>
      {meta ? (
        <div className="space-y-4">
          {meta.description && <p className="max-w-prose text-ink-2">{meta.description}</p>}
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <dt className="text-sm font-semibold text-yes">Resolves Yes if</dt>
              <dd className="text-sm text-ink">{meta.rules.yes}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm font-semibold text-no">Resolves No if</dt>
              <dd className="text-sm text-ink">{meta.rules.no}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm font-semibold">Invalid if</dt>
              <dd className="text-sm text-ink-2">{meta.rules.invalid}</dd>
            </div>
            {meta.rules.ambiguity && (
              <div className="space-y-1">
                <dt className="text-sm font-semibold">Conflicting or unclear evidence</dt>
                <dd className="text-sm text-ink-2">{meta.rules.ambiguity}</dd>
              </div>
            )}
          </dl>
          <dl className="grid gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted">Primary source</dt>
              <dd>
                <a href={meta.source.url} target="_blank" rel="noreferrer nofollow ugc" className="inline-flex items-center gap-1 underline decoration-line underline-offset-2">
                  {meta.source.name} <ExternalLink className="size-3" aria-hidden />
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-muted">Trading closes</dt>
              <dd>{formatDateTime(closeTime)}</dd>
            </div>
            <div>
              <dt className="text-muted">Event evaluated</dt>
              <dd>{formatDateTime(new Date(meta.resolvesAt))}</dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm text-warn">
            <AlertTriangle className="size-4" aria-hidden /> This market was created without MEZONK&apos;s structured rules format. Read
            the raw text carefully.
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-line bg-sunk p-3 text-xs text-ink-2">{raw}</pre>
        </div>
      )}
      <p className="flex items-start gap-2 text-xs text-muted">
        {matches ? (
          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-yes" aria-hidden />
        ) : (
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-no" aria-hidden />
        )}
        <span>
          {matches
            ? "These rules match the hash committed on-chain at creation. They cannot be edited."
            : "Warning: these rules do not match the on-chain hash. Treat them as unverified."}{" "}
          <span className="break-all font-mono">{onchainHash}</span>
        </span>
      </p>
    </section>
  );
}
