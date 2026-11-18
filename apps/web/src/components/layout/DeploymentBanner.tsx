import Link from "next/link";
import { deployment, NETWORK_SITES, readinessMessage } from "@/lib/chain/config";

/**
 * One quiet line saying which network this is: testnet (nothing is real money), mainnet (it is), a local fork, or why
 * trading is off.
 * Deliberately neutral: it is context, not an alarm, and it must never tint the whole page.
 */
export function DeploymentBanner() {
  let text: string | null = null;
  let tone: "warn" | "muted" = "muted";
  if (deployment.ready && !deployment.isLocalFork) {
    if (deployment.chain.testnet) {
      // The testnet site is for practice: say so plainly, and point to the real thing.
      return (
        <div className="mx-auto mt-2 flex max-w-[84rem] justify-center px-4 md:px-6">
          <p className="rounded-full border border-line bg-surface px-3 py-1 text-center text-xs text-ink-2">
            <span aria-hidden className="mr-2 inline-block size-1.5 rounded-full bg-warn align-middle" />
            <span className="font-medium text-ink">Testnet practice.</span> Test BTC and MUSD only, nothing here is real money.{" "}
            {NETWORK_SITES.mainnet ? (
              <a href={NETWORK_SITES.mainnet} className="font-medium text-yes-text underline-offset-2 hover:underline">Go to mainnet</a>
            ) : (
              <Link href="/borrow" className="font-medium text-yes-text underline-offset-2 hover:underline">Get test MUSD</Link>
            )}
          </p>
        </div>
      );
    }
    return (
      <div className="mx-auto mt-2 flex max-w-[84rem] justify-center px-4 md:px-6">
        <p className="rounded-full border border-line bg-surface px-3 py-1 text-center text-xs text-ink-2">
          <span aria-hidden className="pulse-dot mr-2 inline-block size-1.5 rounded-full bg-success align-middle" />
          <span className="font-medium text-ink">Live on Mezo Mainnet.</span> Real BTC and MUSD. Only trade what you can afford to lose.
          {NETWORK_SITES.testnet && (
            <>
              {" "}
              <a href={NETWORK_SITES.testnet} className="font-medium text-yes-text underline-offset-2 hover:underline">Practise on testnet</a>
            </>
          )}
        </p>
      </div>
    );
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
