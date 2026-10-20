import type { Metadata } from "next";
import { DiscoverSections } from "./DiscoverSections";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage() {
  return (
    <div className="space-y-12">
      <div className="max-w-2xl space-y-2">
        <h1 className="display text-5xl md:text-6xl">Discover</h1>
        <p className="text-ink-2">
          What people are trading right now. Every list is computed from on-chain trades: nothing is hand-picked or paid for.
        </p>
      </div>
      <DiscoverSections />
    </div>
  );
}
