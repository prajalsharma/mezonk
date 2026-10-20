"use client";

import Link from "next/link";
import { Status } from "@/components/ui/primitives";
import { cx } from "@/components/ui/cx";
import type { ProposalDto } from "@/lib/governance/dto";
import { statusLabel, type ProposalStatus } from "@/lib/governance/proposal";
import { categoryLabel } from "@/lib/market/metadata";
import { formatDateTime, relativeTime } from "@/lib/format";

const TONE: Record<ProposalStatus, "yes" | "no" | "warn" | "muted" | "accent" | "info" | "success" | "danger"> = {
  draft: "muted",
  submitted: "info",
  under_review: "accent",
  changes_requested: "warn",
  approved: "success",
  scheduled: "success",
  published: "success",
  rejected: "danger",
  withdrawn: "muted",
};

export function ProposalStatusDot({ status }: { status: ProposalStatus }) {
  return <Status tone={TONE[status]}>{statusLabel[status]}</Status>;
}

/** One proposal in a list. Question first, status and timing second; no card chrome. */
export function ProposalRow({ p, index = 0, href }: { p: ProposalDto; index?: number; href?: string }) {
  const target = href ?? (p.marketId ? `/markets/${p.marketId}` : `/proposals/${p.id}`);
  return (
    <li className="rise" style={{ "--i": index } as React.CSSProperties}>
      <Link href={target} className="group grid gap-1.5 px-1 py-3.5 transition-colors hover:bg-surface-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6 sm:rounded-md sm:px-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug text-ink group-hover:underline decoration-line underline-offset-4">{p.metadata.question}</p>
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted">
            <span>{categoryLabel[p.metadata.category]}</span>
            <span>Closes {formatDateTime(new Date(p.closeTime))}</span>
            {p.sponsored && <span className="text-warn">Proposed by the project measured</span>}
            <span>v{p.version}</span>
          </p>
        </div>
        <div className={cx("flex items-center gap-3 text-xs text-muted sm:flex-col sm:items-end sm:gap-1")}>
          <ProposalStatusDot status={p.status} />
          <span>{relativeTime(new Date(p.updatedAt))}</span>
        </div>
      </Link>
    </li>
  );
}
