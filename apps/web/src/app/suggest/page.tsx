import type { Metadata } from "next";
import { Suspense } from "react";
import { SuggestWizard } from "@/features/governance/SuggestWizard";

export const metadata: Metadata = { title: "Suggest a market", description: "Propose a yes/no market for review by MEZONK curators." };

export default function SuggestPage() {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-1">
        <h1 className="text-3xl font-semibold">Suggest a market</h1>
        <p className="text-ink-2">
          Ask a yes/no question with rules a stranger could check. A curator reviews it; if approved, an approved creator seeds it and it goes live.
        </p>
      </div>
      <Suspense>
        <SuggestWizard />
      </Suspense>
    </div>
  );
}
