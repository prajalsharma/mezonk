import type { Metadata } from "next";
import { CuratorDashboard } from "@/features/governance/CuratorDashboard";

export const metadata: Metadata = { title: "Curate", robots: { index: false } };

export default function CuratePage() {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-3">
        <h1 className="display text-5xl md:text-6xl">Curate</h1>
        <p className="text-ink-2">Review suggestions against the market policy. Every decision is public with its reason; approval is a signature your wallet gives, never a key the server holds.</p>
      </div>
      <CuratorDashboard />
    </div>
  );
}
