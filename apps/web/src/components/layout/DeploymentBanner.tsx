import Link from "next/link";
import { deployment, readinessMessage } from "@/lib/chain/config";

/**
 * One quiet line whenever the build cannot trade for real, runs against a local fork, or is on testnet.
 * Deliberately neutral: it is context, not an alarm, and it must never tint the whole page.
 */
export function DeploymentBanner() {
  let text: string | null = null;
  let tone: "warn" | "muted" = "muted";
  if (deployment.ready && !deployment.isLocalFork) {
    if (deployment.chain.testnet) {
      // Testnet is the live product for now: say so plainly, and that nothing here is real money.
      return (
        <div className="mx-auto mt-2 flex max-w-[84rem] justify-center px-4 md:px-6">
          <p className="rounded-full border border-line bg-surface px-3 py-1 text-center text-xs text-ink-2">
            <span aria-hidden className="pulse-dot mr-2 inline-block size-1.5 rounded-full bg-success align-middle" />
            <span className="font-medium text-ink">Live on Mezo Testnet.</span> Test BTC and MUSD only, nothing here is real money.{" "}
            <Link href="/borrow" className="font-medium text-yes-text underline-offset-2 hover:underline">Get MUSD</Link>
          </p>
        </div>
      );
    }
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
