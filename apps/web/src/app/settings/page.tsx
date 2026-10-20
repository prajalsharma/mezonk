import type { Metadata } from "next";
import { SettingsView } from "@/features/settings/SettingsView";

export const metadata: Metadata = { title: "Settings", robots: { index: false } };

export default function SettingsPage() {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-1">
        <h1 className="text-3xl font-semibold">Settings</h1>
        <p className="text-ink-2">Appearance is stored in this browser. Notification and display preferences are stored for your wallet once you sign in.</p>
      </div>
      <SettingsView />
    </div>
  );
}
