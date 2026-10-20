import type { Metadata } from "next";
import { StatusView } from "./StatusView";

export const metadata: Metadata = { title: "System status" };

export default function StatusPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="space-y-1">
        <h1 className="display text-5xl md:text-6xl">System status</h1>
        <p className="text-ink-2">Live checks of the network, contract, database and indexer behind this site.</p>
      </div>
      <StatusView />
    </div>
  );
}
