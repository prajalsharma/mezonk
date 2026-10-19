import type { Metadata } from "next";
import { Suspense } from "react";
import { MarketsBrowser } from "./MarketsBrowser";

export const metadata: Metadata = { title: "Markets" };

export default function MarketsPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">Markets</h1>
        <p className="text-ink-2">Every market indexed from the MEZONK contract. Filter, sort, and open one to trade.</p>
      </div>
      <Suspense>
        <MarketsBrowser />
      </Suspense>
    </div>
  );
}
