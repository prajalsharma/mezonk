"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { apiGet } from "@/lib/api/types";
import { relativeTime } from "@/lib/format";

interface ReferenceDto {
  sourceName: string;
  url: string;
  quote: { probYes: number | null; closed: boolean; fetchedAt: string } | null;
  unavailable: string | null;
}

/**
 * For markets imported from Polymarket or Kalshi: the same question's price there, read live with the time it was
 * read. Shown as context only; it never prices or settles anything here, and it says so.
 */
export function ReferenceOdds({ marketId, sourceName, url }: { marketId: number; sourceName: string; url: string }) {
  const q = useQuery({
    queryKey: ["reference", marketId],
    queryFn: () => apiGet<ReferenceDto>(`/api/markets/${marketId}/reference`),
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: 1,
  });
  const quote = q.data?.quote;
  const p = quote?.probYes;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-ink-2">
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
        Same question on {sourceName} <ExternalLink className="size-3" aria-hidden />
      </a>
      {q.isPending ? (
        <span className="text-muted">checking its price…</span>
      ) : quote?.closed ? (
        <span>· closed there</span>
      ) : p != null ? (
        <span>
          · Yes at <span className="font-mono tabular-nums text-ink">{Math.round(p * 100)}%</span> there,{" "}
          <time dateTime={quote!.fetchedAt}>{relativeTime(new Date(quote!.fetchedAt))}</time>
        </span>
      ) : (
        <span className="text-muted">· its price isn&rsquo;t available right now</span>
      )}
      <span className="basis-full text-muted">This market settles on Mezo&rsquo;s own BTC price, not {sourceName}&rsquo;s result.</span>
    </p>
  );
}
