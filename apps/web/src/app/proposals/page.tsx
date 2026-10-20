import type { Metadata } from "next";
import { Suspense } from "react";
import { ProposalsList } from "@/features/governance/ProposalsList";

export const metadata: Metadata = { title: "Suggestions", description: "Community market suggestions and their review status." };

export default function ProposalsPage() {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-3">
        <h1 className="display text-5xl md:text-6xl">Suggestions</h1>
        <p className="text-ink-2">Every market starts here. Curators review each suggestion in public; reasons for every decision are on the suggestion&apos;s page.</p>
      </div>
      <Suspense>
        <ProposalsList />
      </Suspense>
    </div>
  );
}
