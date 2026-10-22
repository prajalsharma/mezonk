import { ArrowDown, ArrowRight, ArrowUpRight, Lock, Scale, ShieldCheck } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { deployment } from "@/lib/chain/config";
import { LiveMarkets } from "./HomeLive";
import { PayoutCalculator } from "./landing/PayoutCalculator";
import { SeamSplit } from "./landing/SeamSplit";
import { Story } from "./landing/Story";

const PROOF: Array<[typeof Lock, string]> = [
  [Lock, "Rules locked on-chain"],
  [ShieldCheck, "Every pair backed by 1 MUSD"],
  [Scale, "Outcomes open to challenge"],
];

const VERIFY: Array<[string, string]> = [
  ["Rules can't be edited", "A market's rules are hashed into the contract when it's published. Each market page recomputes the hash and shows whether it still matches."],
  ["Outcomes can be challenged", "Proposals, challenges and rulings carry evidence and a transaction you can open yourself."],
  ["Deadlines settle stalemates", "No proposal, or no ruling in time, settles Invalid at 0.50 per share. Nothing stays stuck."],
  ["Markets are reviewed", "A curator signs off on the rules before a creator can publish. The contract checks the signature."],
  ["Nobody can take your claim", "Pausing stops new trades only. Claims, refunds and resolution keep working."],
  ["Rewards come from fees only", "Backers of a new market share part of its trading fees. Nothing is paid from anyone's deposit."],
];

const at = (i: number) => ({ "--i": i }) as CSSProperties;

export default function Home() {
  return (
    <div className="space-y-32 md:space-y-44">
      {/* Hero */}
      <section className="grid items-center gap-14 pt-6 md:pt-14 lg:grid-cols-[1.05fr_1fr] lg:gap-20">
        <div className="space-y-9">
          <h1 className="display text-[3.25rem] sm:text-7xl xl:text-[5.5rem]">
            <span className="line-in" style={at(0)}>Trade what</span>{" "}
            <span className="line-in" style={at(1)}>happens next.</span>
          </h1>
          <p className="rise-in max-w-[33rem] text-xl leading-relaxed text-ink-2" style={at(0)}>
            Buy <span className="font-semibold text-yes-text">Yes</span> or <span className="font-semibold text-ink">No</span> on questions
            with public rules. Every pair is backed by 1 MUSD on Mezo, and every outcome can be challenged before anyone is paid.
          </p>
          <div className="rise-in flex flex-wrap gap-3" style={at(1)}>
            <ButtonLink href="/markets" size="lg">
              Browse markets <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href="#how" size="lg" variant="secondary">
              How it works <ArrowDown className="size-4" />
            </ButtonLink>
          </div>
          <ul className="rise-in flex flex-wrap gap-x-6 gap-y-3 border-t border-line pt-6 text-[0.9375rem] text-ink-2" style={at(2)}>
            {PROOF.map(([Icon, t]) => (
              <li key={t} className="flex items-center gap-2">
                <Icon className="size-4 text-yes-text" strokeWidth={2} aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="rise-in" style={at(1)}>
          <SeamSplit />
        </div>
      </section>

      {/* Markets */}
      <section aria-labelledby="markets" className="space-y-10">
        <div className="reveal flex flex-wrap items-end justify-between gap-4">
          <h2 id="markets" className="display text-5xl md:text-6xl">Markets</h2>
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
          <p className="text-lg text-ink-2">Four stages, all on-chain. Nobody can change the rules once trading starts.</p>
        </div>
        <Story />
      </section>

      {/* Calculator */}
      <section aria-labelledby="calc" className="space-y-10">
        <div className="reveal grid gap-4 lg:grid-cols-[1fr_1fr] lg:items-end">
          <h2 id="calc" className="display text-5xl md:text-6xl">Know your payout before you buy.</h2>
          <p className="max-w-md text-lg text-ink-2 lg:justify-self-end">
            A share costs between 1¢ and 99¢ and pays exactly 1 MUSD if you&apos;re right. Move the price and see what changes.
          </p>
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
            <p className="max-w-sm text-lg opacity-70">Everything that decides who gets paid is on-chain and readable by anyone.</p>
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
        <h2 className="display max-w-3xl text-5xl md:text-7xl">Have a question worth a market?</h2>
        <p className="max-w-xl text-lg text-ink-2">
          Write rules a stranger could check. A curator reviews them in public; once published, the market opens for backers and
          goes live when both sides are funded.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <ButtonLink href="/suggest" size="lg">
            Suggest a market <ArrowRight className="size-4" />
          </ButtonLink>
          <ButtonLink href="/markets" size="lg" variant="secondary">Browse markets</ButtonLink>
        </div>
        <p className="text-sm text-muted">
          {deployment.ready
            ? `Running on ${deployment.isLocalFork ? "a local fork of Mezo Testnet" : deployment.chain.name}. Built on Mezo, settled in MUSD.`
            : "Built on Mezo, settled in MUSD. Trading isn't switched on for this network yet."}
        </p>
      </section>
    </div>
  );
}
