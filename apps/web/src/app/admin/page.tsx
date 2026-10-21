import type { Metadata } from "next";
import { AdminDashboard } from "@/features/admin/AdminDashboard";

export const metadata: Metadata = { title: "Administration", robots: { index: false } };

export default function AdminPage() {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-3">
        <h1 className="display text-5xl md:text-6xl">Administration</h1>
        <p className="text-ink-2">
          Platform roles and account status change here, immediately and on the record. Creator and curator roles live in the contract:
          requests made here only take effect once the contract owner signs them and the chain confirms.
        </p>
      </div>
      <AdminDashboard />
    </div>
  );
}
