import type { Metadata } from "next";
import { ActivityFeed } from "./ActivityFeed";

export const metadata: Metadata = { title: "Activity" };

export default function ActivityPage() {
  return (
    <div className="space-y-6">
      <div className="max-w-2xl space-y-3">
        <h1 className="display text-5xl md:text-6xl">Activity</h1>
        <p className="text-ink-2">
          Every event emitted by the MEZONK contract, newest first. Each row links to its transaction on the explorer.
        </p>
      </div>
      <ActivityFeed />
    </div>
  );
}
