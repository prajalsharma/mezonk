"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/** Header search. Submits to /markets?q=… which queries the indexed market list. "/" focuses it. */
export function SearchBox() {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        router.push(q.trim() ? `/markets?q=${encodeURIComponent(q.trim())}` : "/markets");
      }}
      className="relative w-full max-w-xs"
    >
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        ref={ref}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
        placeholder="Search markets"
        aria-label="Search markets"
        className="h-9 w-full rounded-md border border-line bg-surface pl-8 pr-8 text-sm text-ink placeholder:text-muted hover:border-ink-2 focus:border-ink focus:outline-none"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[11px] text-muted lg:block">
        /
      </kbd>
    </form>
  );
}
