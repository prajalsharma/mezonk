import Link from "next/link";
import { Lockup } from "@/components/brand/Logo";
import { deployment, explorerAddress, readinessMessage } from "@/lib/chain/config";
import { shortAddress } from "@/lib/format";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line pb-24 lg:pb-0">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-[1.3fr_1fr_1fr] md:px-6">
        <div className="space-y-3">
          <Lockup />
          <p className="max-w-sm text-sm text-ink-2">
            An independent prediction market on Mezo. Not affiliated with or endorsed by Mezo. Prices are not
            predictions of certainty and nothing here is financial advice.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-2 text-sm">
          <Link className="text-ink-2 hover:text-ink" href="/docs">How it works</Link>
          <Link className="text-ink-2 hover:text-ink" href="/docs#resolution">Resolution</Link>
          <Link className="text-ink-2 hover:text-ink" href="/docs#fees">Fees</Link>
          <Link className="text-ink-2 hover:text-ink" href="/docs#risks">Risks</Link>
          <Link className="text-ink-2 hover:text-ink" href="/docs#contracts">Contracts</Link>
          <Link className="text-ink-2 hover:text-ink" href="/docs#policy">Market policy</Link>
          <Link className="text-ink-2 hover:text-ink" href="/status">System status</Link>
        </nav>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Network</dt>
            <dd>{deployment.isLocalFork ? `Local fork of ${deployment.chain.name}` : deployment.chain.name}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Market contract</dt>
            <dd className="font-mono text-xs">
              {deployment.marketsAddress ? (
                explorerAddress(deployment.marketsAddress) ? (
                  <a className="underline decoration-line underline-offset-2" href={explorerAddress(deployment.marketsAddress)!} target="_blank" rel="noreferrer">
                    {shortAddress(deployment.marketsAddress)}
                  </a>
                ) : (
                  shortAddress(deployment.marketsAddress)
                )
              ) : (
                "Not deployed"
              )}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-ink-2">Collateral</dt>
            <dd className="font-mono text-xs">
              {explorerAddress(deployment.musd) ? (
                <a className="underline decoration-line underline-offset-2" href={explorerAddress(deployment.musd)!} target="_blank" rel="noreferrer">
                  MUSD {shortAddress(deployment.musd)}
                </a>
              ) : (
                `MUSD ${shortAddress(deployment.musd)}`
              )}
            </dd>
          </div>
          {!deployment.ready && <p className="pt-2 text-warn">{readinessMessage[deployment.reason]}</p>}
        </dl>
      </div>
    </footer>
  );
}
