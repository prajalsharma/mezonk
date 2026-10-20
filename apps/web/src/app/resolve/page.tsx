import type { Metadata } from "next";
import { ResolutionCenter } from "@/features/resolution/ResolutionCenter";

export const metadata: Metadata = { title: "Resolution center", description: "Markets awaiting an outcome, a challenge, a ruling or finalization." };

export default function ResolvePage() {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-1">
        <h1 className="text-3xl font-semibold">Resolution center</h1>
        <p className="text-ink-2">Everything between trading close and payout. Resolvers propose, anyone can challenge, the arbitrator rules, and anyone can finalize once a deadline passes.</p>
      </div>
      <ResolutionCenter />
    </div>
  );
}
