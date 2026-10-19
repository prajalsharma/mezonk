import type { Metadata } from "next";
import { CreateWizard } from "@/features/create/CreateWizard";

export const metadata: Metadata = { title: "Create a market" };

export default function CreatePage() {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-1">
        <h1 className="text-3xl font-semibold">Create a market</h1>
        <p className="text-ink-2">
          Ask a yes/no question with rules a stranger could check, seed the pool with MUSD, and earn the creator share of trading fees.
        </p>
      </div>
      <CreateWizard />
    </div>
  );
}
