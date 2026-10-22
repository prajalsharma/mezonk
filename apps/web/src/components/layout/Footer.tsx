import Link from "next/link";
import { Lockup } from "@/components/brand/Logo";
import { deployment, explorerAddress, readinessMessage } from "@/lib/chain/config";
import { shortAddress } from "@/lib/format";

const GROUPS: Array<{ title: string; links: Array<[string, string]> }> = [
  {
    title: "Markets",
    links: [
      ["Discover", "/discover"],
      ["All markets", "/markets"],
      ["Resolution center", "/resolve"],
      ["Activity", "/activity"],
    ],
  },
  {
    title: "Create",
    links: [
      ["Suggest a market", "/suggest"],
      ["Suggestions", "/proposals"],
      ["Market policy", "/docs#policy"],
      ["Settings", "/settings"],
    ],
  },
  {
    title: "Learn",
    links: [
      ["How it works", "/docs"],
      ["Resolution", "/docs#resolution"],
      ["Fees", "/docs#fees"],
      ["Risks", "/docs#risks"],
      ["Contracts", "/docs#contracts"],
      ["System status", "/status"],
    ],
  },
];

function ChainLink({ address, label }: { address: string; label: string }) {
  const url = explorerAddress(address);
  return url ? (
    <a className="underline decoration-line underline-offset-2 hover:text-ink" href={url} target="_blank" rel="noreferrer">
      {label} {shortAddress(address)}
    </a>
  ) : (
    <span>
      {label} {shortAddress(address)}
    </span>
  );
}

export function Footer() {
  return (
    <footer className="mt-28 border-t border-line bg-surface pb-28 lg:pb-0">
      <div className="mx-auto grid max-w-[84rem] gap-12 px-4 py-14 md:px-6 lg:grid-cols-[1.4fr_2fr]">
        <div className="space-y-5">
          <Link href="/" className="inline-flex items-center gap-3 text-ink" aria-label="MEZONK home">
            <Lockup size={30} />
          </Link>
          <p className="max-w-sm text-sm text-ink-2">
            Prediction markets built on{" "}
            <a href="https://mezo.org" target="_blank" rel="noreferrer" className="font-medium text-ink underline decoration-line underline-offset-2">
              Mezo
            </a>
            , settled in MUSD. Prices are not predictions of certainty and nothing here is financial advice.
          </p>
          <dl className="mono space-y-1 text-xs text-muted">
            <div className="flex gap-2">
              <dt>Network</dt>
              <dd className="text-ink-2">{deployment.isLocalFork ? `Local fork of ${deployment.chain.name}` : deployment.chain.name}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Market</dt>
              <dd className="text-ink-2">{deployment.marketsAddress ? <ChainLink address={deployment.marketsAddress} label="contract" /> : "Not deployed"}</dd>
            </div>
            <div className="flex gap-2">
              <dt>Collateral</dt>
              <dd className="text-ink-2"><ChainLink address={deployment.musd} label="MUSD" /></dd>
            </div>
          </dl>
          {!deployment.ready && <p className="text-sm text-warn">{readinessMessage[deployment.reason]}</p>}
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.title} className="space-y-3">
              <p className="label">{g.title}</p>
              <ul className="space-y-2 text-sm">
                {g.links.map(([l, h]) => (
                  <li key={h}>
                    <Link className="text-ink-2 transition-colors hover:text-ink" href={h}>
                      {l}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
    </footer>
  );
}
