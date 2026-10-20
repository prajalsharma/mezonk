import { deployment, readinessMessage } from "@/lib/chain/config";

/**
 * One quiet line whenever the build cannot trade for real, runs against a local fork, or is on testnet.
 * Deliberately neutral: it is context, not an alarm, and it must never tint the whole page.
 */
export function DeploymentBanner() {
  let text: string | null = null;
  let tone: "warn" | "muted" = "muted";
  if (deployment.ready && !deployment.isLocalFork) {
    if (deployment.chain.testnet) text = "Testnet. MUSD here has no cash value and results are not real profit.";
  } else {
    tone = "warn";
    text =
      deployment.isLocalFork && deployment.ready
        ? "Local development fork of Mezo Testnet. Transactions here never reach the public network."
        : readinessMessage[deployment.reason];
  }
  if (!text) return null;
  return (
    <div className="mx-auto mt-2 flex max-w-[84rem] justify-center px-4 md:px-6">
      <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2">
        <span aria-hidden className={tone === "warn" ? "size-1.5 rounded-full bg-warn" : "size-1.5 rounded-full bg-muted"} />
        {text}
      </p>
    </div>
  );
}
