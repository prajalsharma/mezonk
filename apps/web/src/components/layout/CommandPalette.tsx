"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/components/ui/cx";
import { apiGet, type MarketListDto } from "@/lib/api/types";
import { formatProb } from "@/lib/format";

const PAGES = [
  { href: "/discover", label: "Discover markets" },
  { href: "/markets", label: "All markets" },
  { href: "/suggest", label: "Suggest a market" },
  { href: "/proposals", label: "Market suggestions" },
  { href: "/portfolio", label: "Portfolio and claims" },
  { href: "/activity", label: "Activity" },
  { href: "/resolve", label: "Resolution center" },
  { href: "/settings", label: "Settings" },
  { href: "/docs", label: "How it works" },
  { href: "/status", label: "System status" },
];

/** ⌘K / Ctrl+K: search markets and jump to pages. Glass surface (a floating overlay). */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      setQ("");
      setActive(0);
      setTimeout(() => input.current?.focus(), 20);
    }
    if (!open && d.open) d.close();
  }, [open]);

  const markets = useQuery({
    queryKey: ["palette", q],
    enabled: open && q.trim().length >= 2,
    queryFn: () => apiGet<MarketListDto>(`/api/markets?q=${encodeURIComponent(q.trim())}&limit=6&status=all`),
    staleTime: 10_000,
  });

  const items = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const pages = PAGES.filter((p) => !ql || p.label.toLowerCase().includes(ql)).map((p) => ({ kind: "page" as const, ...p }));
    const ms = (markets.data?.items ?? []).map((m) => ({ kind: "market" as const, href: `/markets/${m.id}`, label: m.question, price: m.priceYes, stage: m.stage.label }));
    return [...ms, ...pages];
  }, [q, markets.data]);

  useEffect(() => setActive(0), [items.length]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onCancel={onClose}
      aria-label="Search and navigate"
      className="glass m-0 mt-[10vh] w-full max-w-none justify-self-center rounded-lg border p-0 text-ink shadow-3 backdrop:bg-[var(--overlay)] sm:mx-auto sm:max-w-xl"
    >
      <div className="flex items-center gap-2 border-b border-[var(--glass-border)] px-4">
        <Search className="size-4 text-muted" aria-hidden />
        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === "Enter" && items[active]) { e.preventDefault(); go(items[active]!.href); }
          }}
          placeholder="Search markets or jump to a page"
          aria-label="Search"
          aria-controls="palette-list"
          aria-activedescendant={items[active] ? `palette-${active}` : undefined}
          className="h-12 w-full bg-transparent text-base text-ink placeholder:text-muted focus:outline-none"
        />
        <kbd className="hidden rounded border border-line px-1.5 text-[11px] text-muted sm:block">esc</kbd>
      </div>
      <ul id="palette-list" role="listbox" className="max-h-[60vh] overflow-y-auto p-2">
        {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">{markets.isFetching ? "Searching…" : "Nothing matches."}</li>}
        {items.map((it, i) => (
          <li
            key={it.href + i}
            id={`palette-${i}`}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => go(it.href)}
            className={cx("flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm", i === active ? "bg-surface-2 text-ink" : "text-ink-2")}
          >
            {it.kind === "market" ? (
              <>
                <span className="tnum w-11 shrink-0 font-semibold text-ink">{formatProb(it.price)}</span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <span className="shrink-0 text-xs text-muted">{it.stage}</span>
              </>
            ) : (
              <>
                <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="flex-1">{it.label}</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </dialog>
  );
}
