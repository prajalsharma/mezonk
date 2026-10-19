"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { EmptyState, inputClass } from "@/components/ui/primitives";
import { MarketList } from "@/components/markets/MarketList";
import { useMarkets } from "@/hooks/useMarkets";
import { CATEGORIES, categoryLabel } from "@/lib/market/metadata";

const STATUS = [
  { v: "all", l: "All" },
  { v: "open", l: "Open" },
  { v: "closing", l: "Closing in 48h" },
  { v: "resolving", l: "Resolving" },
  { v: "resolved", l: "Settled" },
];
const SORTS = [
  { v: "newest", l: "Newest" },
  { v: "trending", l: "Trending" },
  { v: "volume", l: "Volume" },
  { v: "liquidity", l: "Most collateral" },
  { v: "thin", l: "Least collateral" },
  { v: "closing", l: "Closing soonest" },
  { v: "movement", l: "24h movement" },
];
const LIQ = [
  { v: "", l: "Any collateral" },
  { v: "100", l: "100+ MUSD" },
  { v: "1000", l: "1,000+ MUSD" },
  { v: "10000", l: "10,000+ MUSD" },
];
const PAGE = 24;

export function MarketsBrowser() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const get = (k: string, d = "") => params.get(k) ?? d;
  const [text, setText] = useState(get("q"));
  const [limit, setLimit] = useState(PAGE);

  const set = (patch: Record<string, string>) => {
    const s = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) s.set(k, v);
      else s.delete(k);
    }
    router.replace(`${path}?${s}`, { scroll: false });
    setLimit(PAGE);
  };

  // Debounced search → URL.
  useEffect(() => {
    if (text === get("q")) return;
    const t = setTimeout(() => set({ q: text.trim() }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
  useEffect(() => setText(get("q")), [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const query = useMemo(
    () => ({
      q: get("q") || undefined,
      category: get("category") || undefined,
      status: get("status", "all"),
      sort: get("sort", "newest"),
      minLiquidity: get("minLiquidity") ? Number(get("minLiquidity")) : undefined,
      limit,
      offset: 0,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [params, limit],
  );
  const { data, isLoading, error, isFetching } = useMarkets(query);
  const filtered = !!(query.q || query.category || query.status !== "all" || query.minLiquidity);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search by question or description"
            aria-label="Search markets"
            className={cx(inputClass, "pl-9")}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <select aria-label="Sort by" value={query.sort} onChange={(e) => set({ sort: e.target.value })} className={cx(inputClass, "sm:w-44")}>
            {SORTS.map((s) => (
              <option key={s.v} value={s.v}>Sort: {s.l}</option>
            ))}
          </select>
          <select aria-label="Minimum collateral" value={get("minLiquidity")} onChange={(e) => set({ minLiquidity: e.target.value })} className={cx(inputClass, "sm:w-44")}>
            {LIQ.map((s) => (
              <option key={s.v} value={s.v}>{s.l}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div role="group" aria-label="Status" className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
          {STATUS.map((s) => (
            <button
              key={s.v}
              aria-pressed={query.status === s.v}
              onClick={() => set({ status: s.v === "all" ? "" : s.v })}
              className={cx(
                "shrink-0 rounded-md px-3 py-1.5 text-sm font-semibold",
                query.status === s.v ? "bg-primary text-on-primary" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              {s.l}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Category" className="-mx-4 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              aria-pressed={query.category === c}
              onClick={() => set({ category: query.category === c ? "" : c })}
              className={cx(
                "shrink-0 rounded-md border px-2.5 py-1 text-sm",
                query.category === c ? "border-ink text-ink" : "border-line text-ink-2 hover:text-ink",
              )}
            >
              {categoryLabel[c]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted" aria-live="polite">
        <span>
          {data ? `${data.total} market${data.total === 1 ? "" : "s"}` : " "}
          {isFetching && data ? " · updating" : ""}
        </span>
        {filtered && (
          <button className="inline-flex items-center gap-1 text-ink-2 hover:text-ink" onClick={() => router.replace(path)}>
            <X className="size-3.5" /> Clear filters
          </button>
        )}
      </div>

      <MarketList
        items={data?.items}
        isLoading={isLoading}
        error={error}
        empty={
          filtered ? (
            <EmptyState title="No markets match these filters">Try a broader search or clear the filters.</EmptyState>
          ) : (
            <EmptyState
              title="No markets yet"
              action={<ButtonLink href="/create">Create the first market</ButtonLink>}
            >
              Markets appear here as soon as they are created on-chain and indexed.
            </EmptyState>
          )
        }
      />
      {data && data.total > data.items.length && (
        <div className="flex justify-center">
          <Button variant="secondary" loading={isFetching} onClick={() => setLimit((l) => l + PAGE)}>
            Show more
          </Button>
        </div>
      )}
    </div>
  );
}
