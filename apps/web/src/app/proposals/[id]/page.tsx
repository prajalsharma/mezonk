import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProposalView } from "@/features/governance/ProposalView";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  if (!UUID.test(id)) return { title: "Suggestion" };
  try {
    const { getProposal } = await import("@/server/governance");
    const r = await getProposal(id);
    return { title: r ? r.proposal.metadata.question : "Suggestion" };
  } catch {
    return { title: "Suggestion" };
  }
}

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <Suspense>
      <ProposalView id={id} />
    </Suspense>
  );
}
