import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { deployment } from "@/lib/chain/config";
import { LiveMarkets } from "./HomeLive";
import { FundingFlow } from "./landing/FundingFlow";
import { PayoutCalculator } from "./landing/PayoutCalculator";
import { SeamSplit } from "./landing/SeamSplit";
import { Story } from "./landing/Story";

const VERIFY: Array<[string, string]> = [
  ["The rules can't move", "Every market's rules are fingerprinted on-chain the moment it opens. Each market page checks the fingerprint still matches, so nobody can quietly edit the question."],
  ["You can argue with the result", "Every outcome comes with evidence and a challenge window. Think it's wrong? Post a bond and say so; an arbitrator rules in public."],
  ["Nothing gets stuck", "If nobody proposes an outcome, or a ruling runs late, the market settles Invalid and every share pays 0.50 MUSD."],
  ["Your claim is yours", "Even if trading is paused, claims, refunds and resolution keep working. The money sits in the contract, not with us."],
];

const at = (i: number) => ({ "--i": i }) as CSSProperties;

export default function Home() {
  return (
    <div className="space-y-32 md:space-y-44">
      {/* Hero */}
      <section className="grid items-center gap-14 pt-4 md:pt-12 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
        <div className="space-y-8">
          <p className="rise-in flex items-center gap-3 text-xl font-medium tracking-tight text-ink-2 md:text-2xl" style={at(0)}>
            <span aria-hidden className="h-0.5 w-8 rounded-full bg-yes" />
            <span>
              The first prediction market <span className="font-semibold text-ink">on Mezo</span>
            </span>
          </p>
          <h1 className="display text-[3.1rem] sm:text-7xl lg:text-6xl xl:text-[4.25rem] 2xl:text-[4.6rem]">
            <span className="line-in" style={at(0)}>Call it right.</span>{" "}
            <span className="line-in xl:whitespace-nowrap" style={at(1)}>Keep your bitcoin.</span>
          </h1>
          <p className="rise-in max-w-[31rem] text-xl leading-relaxed text-ink-2" style={at(1)}>
            Borrow MUSD against your BTC on Mezo, back <span className="font-semibold text-yes-text">Yes</span> or{" "}
            <span className="font-semibold text-ink">No</span>, and get paid in MUSD when you&apos;re right.
          </p>
          <div className="rise-in flex flex-wrap gap-3" style={at(2)}>
            <ButtonLink href="/markets" size="lg">
              Browse markets <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href="#funding" size="lg" variant="secondary">How funding works</ButtonLink>
          </div>
        </div>
        <div className="rise-in" style={at(2)}>
          <SeamSplit />
        </div>
      </section>

      {/* Funding */}
      <section id="funding" aria-labelledby="funding-h" className="scroll-mt-28 space-y-10">
        <div className="reveal max-w-2xl space-y-4">
          <h2 id="funding-h" className="display text-5xl md:text-6xl">Your bitcoin stays yours.</h2>
          <p className="text-lg text-ink-2">
            You don&apos;t have to sell BTC to place a trade. Borrow MUSD against it on Mezo and trade with that, or use the MUSD you
            already have.
          </p>
        </div>
        <div className="reveal">
          <FundingFlow />
        </div>
      </section>

      {/* Markets */}
      <section aria-labelledby="markets" className="space-y-10">
        <div className="reveal flex flex-wrap items-end justify-between gap-4">
          <h2 id="markets" className="display text-5xl md:text-6xl">Live on Mezo</h2>
          <Link href="/markets" className="inline-flex items-center gap-1.5 font-medium text-ink-2 hover:text-ink">
            All markets <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <LiveMarkets />
      </section>

      {/* How it works */}
      <section id="how" aria-labelledby="how-h" className="scroll-mt-28 space-y-12 md:space-y-4">
        <div className="reveal max-w-2xl space-y-4">
          <h2 id="how-h" className="display text-5xl md:text-6xl">From question to payout.</h2>
          <p className="text-lg text-ink-2">Every market goes through the same four stages, in the open, on Mezo.</p>
        </div>
        <Story />
      </section>

      {/* Calculator */}
      <section aria-labelledby="calc" className="space-y-10">
        <div className="reveal max-w-2xl space-y-4">
          <h2 id="calc" className="display text-5xl md:text-6xl">What&apos;s your hunch worth?</h2>
          <p className="text-lg text-ink-2">Pick a side and a price. Every winning share pays exactly 1 MUSD, so you know the upside before you buy.</p>
        </div>
        <div className="reveal">
          <PayoutCalculator />
        </div>
      </section>

      {/* Trust */}
      <section
        aria-labelledby="verify"
        className="reveal rounded-lg bg-no px-6 py-14 text-on-no md:px-14 md:py-20 dark:border dark:border-line dark:bg-surface dark:text-ink"
      >
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.4fr]">
          <div className="space-y-5">
            <h2 id="verify" className="display text-5xl md:text-6xl">Don&apos;t trust us. Check.</h2>
            <p className="max-w-sm text-lg opacity-70">Bitcoin people verify. Everything that decides who gets paid lives on Mezo, readable by anyone.</p>
            <Link href="/docs#contracts" className="inline-flex items-center gap-1.5 font-medium opacity-80 transition-opacity hover:opacity-100">
              Read the contracts <ArrowUpRight className="size-4" />
            </Link>
          </div>
          <dl className="grid gap-x-10 sm:grid-cols-2">
            {VERIFY.map(([t, b]) => (
              <div key={t} className="space-y-2 border-t border-current/15 py-6">
                <dt className="text-lg font-medium">{t}</dt>
                <dd className="opacity-70">{b}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Final call */}
      <section className="reveal flex flex-col items-center gap-8 pb-8 text-center">
        <LogoMark size={64} title="" />
        <h2 className="display max-w-3xl text-5xl md:text-7xl">Know something the market doesn&apos;t?</h2>
        <p className="max-w-xl text-lg text-ink-2">
          Suggest the question. Write rules a stranger could check, a curator reviews them in public, and backers decide if it goes live.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/suggest" size="lg">
            Suggest a market <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
        <p className="text-sm text-muted">
          {deployment.ready
            ? `Built on Mezo, settled in MUSD. Running on ${deployment.isLocalFork ? "a local fork of Mezo Testnet" : deployment.chain.name}.`
            : "Built on Mezo, settled in MUSD. Trading isn't switched on for this network yet."}
        </p>
      </section>
    </div>
  );
}
