import { ArrowRight, ArrowUpRight, FileCheck2, Gavel, Lock, Scale } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { Ticker } from "@/components/markets/Ticker";
import { deployment } from "@/lib/chain/config";
import { Board, HeroStats, HeroTicket } from "./HomeLive";

const LIFECYCLE: Array<[string, string]> = [
  ["Pick a side", "Buy Yes or No with MUSD. A share costs between 0 and 1; the price is the market's estimate of the chance."],
  ["Change your mind", "Sell back to the pool at the live price any time before trading closes. 1% fee each way."],
  ["Trading closes", "The close time is fixed when the market is published, at or before the event is evaluated."],
  ["Outcome, then a challenge window", "The resolver proposes Yes, No or Invalid with evidence and a bond. Anyone else can challenge it."],
  ["Get paid", "Each winning share redeems for exactly 1 MUSD. An Invalid market pays 0.5 MUSD per share."],
];

export default function Home() {
  return (
    <div className="space-y-24 md:space-y-32">
      {/* Hero */}
      <section className="relative -mx-4 overflow-hidden px-4 pb-4 pt-8 md:-mx-6 md:px-6 md:pt-14">
        <div aria-hidden className="grid-bg absolute inset-0 -z-10" />
        <div aria-hidden className="glow absolute inset-0 -z-10" />
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div className="space-y-8">
            <p className="mono inline-flex items-center gap-2 rounded-full border border-line bg-surface/70 px-3 py-1 text-xs text-ink-2">
              <LogoMark size={14} title="" />
              Built on Mezo · settled in MUSD
            </p>
            <h1 className="display text-[3.4rem] leading-[0.95] sm:text-7xl lg:text-[5.75rem]">
              Call it <em className="text-accent-text">before</em>
              <br />
              it happens.
            </h1>
            <p className="max-w-[34rem] text-lg text-ink-2">
              Trade Yes or No on what happens next. Rules are locked on-chain the moment a market opens, every share is
              backed 1:1 by MUSD, and every outcome sits in a public challenge window before anyone gets paid.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/discover" size="lg" variant="accent">
                Explore markets <ArrowRight className="size-4" />
              </ButtonLink>
              <ButtonLink href="/suggest" size="lg" variant="secondary">Suggest a market</ButtonLink>
            </div>
            <HeroStats />
          </div>
          <HeroTicket />
        </div>
      </section>

      <div className="-mt-16 md:-mt-20">
        <Ticker />
      </div>

      {/* Board */}
      <section aria-labelledby="board" className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <h2 id="board" className="display text-5xl md:text-6xl">
              What the market <em>thinks</em>
            </h2>
            <p className="max-w-xl text-ink-2">Open markets ranked by real trading in the last 24 hours. Pick a side straight from the board.</p>
          </div>
          <Link href="/markets" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
            All markets <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <Board />
      </section>

      {/* Lifecycle */}
      <section aria-labelledby="how" className="space-y-10">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr] lg:items-end">
          <h2 id="how" className="display text-5xl md:text-6xl">
            From hunch <em>to payout</em>
          </h2>
          <p className="max-w-xl text-ink-2 lg:justify-self-end">
            Five steps, all on-chain. Nobody can change the rules once trading starts, and nobody can take a claim you have earned.
          </p>
        </div>
        <ol className="relative grid gap-3 md:grid-cols-5">
          <div aria-hidden className="absolute left-0 right-0 top-[1.4rem] hidden h-px bg-gradient-to-r from-accent via-line to-line md:block" />
          {LIFECYCLE.map(([t, b], i) => (
            <li key={t} className="relative space-y-3 md:pr-2">
              <span className="mono relative z-10 flex size-11 items-center justify-center rounded-full border border-line bg-bg text-sm font-semibold text-ink">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h3 className="font-medium">{t}</h3>
              <p className="text-sm text-ink-2">{b}</p>
            </li>
          ))}
        </ol>

        <div className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
          <div className="panel space-y-4 p-6">
            <p className="label">Worked example · illustrative, not a live market</p>
            <p className="text-lg font-medium leading-snug">Will BTC close above $150,000 on 31 December?</p>
            <dl className="mono divide-y divide-line text-sm">
              {[
                ["Yes price", "0.40 MUSD"],
                ["You spend", "40.00 MUSD"],
                ["You receive (after 1% fee and price impact)", "≈ 99 Yes"],
                ["If Yes wins", "99.00 MUSD"],
                ["If No wins", "0.00 MUSD"],
                ["If ruled Invalid", "49.50 MUSD"],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2">
                  <dt className="font-sans text-ink-2">{k}</dt>
                  <dd className="text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="panel relative overflow-hidden p-6">
            <div aria-hidden className="grid-bg absolute inset-0" />
            <div className="relative space-y-4">
              <p className="label">Why every share is backed</p>
              <div className="flex items-center gap-4 py-4">
                <div className="flex flex-col items-center gap-1">
                  <span className="mono flex size-20 items-center justify-center rounded-full border border-line bg-surface text-lg font-semibold">1 MUSD</span>
                </div>
                <span className="mono text-2xl text-muted">=</span>
                <span className="mono flex h-12 items-center rounded-md bg-yes px-4 font-semibold text-on-yes">1 Yes</span>
                <span className="mono text-2xl text-muted">+</span>
                <span className="mono flex h-12 items-center rounded-md bg-no px-4 font-semibold text-on-no">1 No</span>
              </div>
              <p className="max-w-md text-sm text-ink-2">
                Every MUSD that enters a market mints one Yes and one No. Exactly one side pays out, so the contract always holds
                enough to pay every winner. Nobody, including the protocol owner, can withdraw it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Proof */}
      <section aria-labelledby="trust" className="space-y-8">
        <h2 id="trust" className="display text-5xl md:text-6xl">
          Check it <em>yourself</em>
        </h2>
        <ul className="grid gap-3 md:grid-cols-6">
          {[
            [Lock, "Rules can't be edited", "A market's rules are hashed into the contract at creation. Every market page recomputes the hash and shows whether it still matches.", "md:col-span-3"],
            [Scale, "Outcomes can be challenged", "Proposals, challenges and rulings carry evidence and a transaction you can open yourself.", "md:col-span-3"],
            [Gavel, "Deadlines settle stalemates", "No proposal, or no ruling in time, settles Invalid at 0.5 per share. Nothing stays stuck.", "md:col-span-2"],
            [FileCheck2, "Markets are reviewed", "A curator signs off on the rules before an approved creator can publish. The contract checks the signature.", "md:col-span-2"],
            [ArrowUpRight, "Nobody can take your claim", "Pausing stops new trades only. Claims, refunds and resolution keep working.", "md:col-span-2"],
          ].map(([Icon, t, b, span]) => {
            const I = Icon as typeof Lock;
            return (
              <li key={t as string} className={`panel card-hover space-y-3 p-6 ${span as string}`}>
                <span className="flex size-10 items-center justify-center rounded-md border border-line bg-surface-2 text-accent-text">
                  <I className="size-5" strokeWidth={1.75} />
                </span>
                <h3 className="text-lg font-medium">{t as string}</h3>
                <p className="max-w-md text-sm text-ink-2">{b as string}</p>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Governance + CTA */}
      <section className="relative overflow-hidden rounded-xl border border-line bg-surface px-6 py-12 md:px-12 md:py-16">
        <div aria-hidden className="glow absolute inset-0" />
        <div className="relative grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div className="space-y-5">
            <h2 className="display text-5xl md:text-6xl">
              Have a question <em>worth a market?</em>
            </h2>
            <p className="max-w-lg text-ink-2">
              Write rules a stranger could check and submit them. A curator reviews in public, with reasons, and an approved creator
              seeds and publishes it.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/suggest" size="lg" variant="primary">
                Suggest a market <ArrowRight className="size-4" />
              </ButtonLink>
              <ButtonLink href="/proposals" size="lg" variant="ghost">See the review queue</ButtonLink>
            </div>
          </div>
          <ol className="mono space-y-2 text-sm">
            {["You suggest", "A curator reviews and signs", "A creator seeds and publishes", "It trades on-chain"].map((s, i) => (
              <li key={s} className="flex items-center gap-3 rounded-md border border-line bg-bg/60 px-4 py-3">
                <span className="text-accent-text">{String(i + 1).padStart(2, "0")}</span>
                <span className="font-sans text-ink">{s}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="relative mt-10 text-xs text-muted">
          {deployment.ready
            ? `Running on ${deployment.isLocalFork ? "a local fork of Mezo Testnet" : deployment.chain.name}.`
            : "The market contract isn't deployed on this network yet."}
        </p>
      </section>
    </div>
  );
}
