import { deployment, readinessMessage } from "@/lib/chain/config";

/** Site-wide notice whenever the build cannot trade for real, or runs against a local fork. */
export function DeploymentBanner() {
  if (deployment.ready && !deployment.isLocalFork) {
    return deployment.chain.testnet ? (
      <div className="border-b border-line bg-surface-2">
        <p className="mx-auto max-w-7xl px-4 py-1.5 text-center text-xs text-ink-2 md:px-6">
          Testnet. MUSD here has no cash value and results are not real profit.
        </p>
      </div>
    ) : null;
  }
  return (
    <div className="border-b border-warn/40 bg-warn-soft">
      <p className="mx-auto max-w-7xl px-4 py-2 text-center text-sm text-ink md:px-6">
        {deployment.isLocalFork && deployment.ready
          ? "Local development fork of Mezo Testnet. Transactions here never reach the public network."
          : readinessMessage[deployment.reason]}
      </p>
    </div>
  );
}
