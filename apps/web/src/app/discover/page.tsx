import type { Metadata } from "next";
import { DiscoverSections } from "./DiscoverSections";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage() {
  return (
    <div className="space-y-12">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-semibold">Discover</h1>
        <p className="text-ink-2">
          What people are trading on Mezo right now. Every list below is computed from on-chain trades. Nothing is
          hand-picked or paid for.
        </p>
      </div>
      <DiscoverSections />
    </div>
  );
}
