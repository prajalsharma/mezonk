import { ArrowUpRight } from "lucide-react";
import Link from "next/link";

/**
 * What happens after you trade, and what protects you at each stage. One dark band, one timeline:
 * each stage gets one line, and the guarantee that applies hangs under it.
 */
const STAGES = [
  {
    name: "Seeding",
    what: "Backers put up real offers on both sides. If it doesn't fill by the deadline, everyone is refunded.",
    guard: "The rules are fingerprinted on-chain the moment it opens. Nobody can quietly edit the question.",
  },
  {
    name: "Live",
    what: "Buy or sell against other people's orders until it closes. MEZONK never takes the other side.",
    guard: "Your money sits in the contract, not with us. Claims and refunds work even if trading is paused.",
  },
  {
    name: "Checked",
    what: "After close, a resolver proposes the result with evidence and puts up a bond.",
    guard: "Think it's wrong? Post a bond and challenge it. An arbitrator rules in public.",
  },
  {
    name: "Paid",
    what: "Each winning share redeems for 1 MUSD, straight from the contract.",
    guard: "If nobody resolves it or the question can't be answered fairly, it settles Invalid and every share pays 0.50.",
  },
];

export function TrustBand() {
  return (
    <section
      aria-labelledby="after-h"
      className="relative overflow-hidden rounded-lg bg-no px-6 py-14 text-on-no md:px-14 md:py-20 dark:border dark:border-line dark:bg-surface dark:text-ink"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_60%_at_85%_0%,oklch(0.6_0.2_262/0.28),transparent_70%)]" />
      <div className="relative space-y-12">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 id="after-h" className="display max-w-xl text-4xl md:text-5xl">
            After you trade, every step is on-chain.
          </h2>
          <Link href="/docs#contracts" className="inline-flex items-center gap-1.5 font-medium opacity-80 transition-opacity hover:opacity-100">
            Read the contracts <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <ol className="grid gap-px overflow-hidden rounded-md bg-current/10 md:grid-cols-4">
          {STAGES.map((s, i) => (
            <li
              key={s.name}
              tabIndex={0}
              className="group flex flex-col gap-4 bg-no p-6 outline-none transition-colors duration-200 hover:bg-[color-mix(in_oklch,var(--no)_88%,white)] focus-visible:bg-[color-mix(in_oklch,var(--no)_88%,white)] dark:bg-surface dark:hover:bg-surface-2 dark:focus-visible:bg-surface-2"
            >
              <span className="flex items-center gap-3">
                <span className="mono text-sm opacity-50">{i + 1}</span>
                <span className="text-lg font-semibold">{s.name}</span>
              </span>
              <p className="opacity-75">{s.what}</p>
              <p className="mt-auto border-t border-current/15 pt-4 text-sm opacity-60 transition-opacity duration-200 group-hover:opacity-90 group-focus-visible:opacity-90">
                {s.guard}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
