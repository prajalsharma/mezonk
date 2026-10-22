import { ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { CSSProperties } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { deployment } from "@/lib/chain/config";
import { Board, HeroCounts, HeroTicket, PayoutExample } from "./HomeLive";

const LIFECYCLE: Array<[string, string]> = [
  ["Seeding", "A reviewed market opens for backers. They lock funded offers on both sides. If there isn't enough by the deadline, everyone is refunded."],
  ["Live", "Once both sides are funded, anyone can buy Yes or No from those offers, at a price between 1¢ and 99¢. MEZONK never takes a side."],
  ["Change your mind", "Sell to the best offer any time before trading closes, or post your own price and wait."],
  ["Trading closes", "The close time is fixed when the market is published, at or before the event is checked."],
  ["Outcome, then a challenge window", "The resolver proposes Yes, No or Invalid with evidence and a bond. Anyone else can challenge it."],
  ["Get paid", "Each winning share redeems for exactly 1 MUSD. An Invalid market pays 0.50 MUSD per share."],
];

const VERIFY: Array<[string, string]> = [
  ["Rules can't be edited", "A market's rules are hashed into the contract when it's published. Each market page recomputes the hash and shows whether it still matches."],
  ["Outcomes can be challenged", "Proposals, challenges and rulings carry evidence and a transaction you can open yourself."],
  ["Deadlines settle stalemates", "No proposal, or no ruling in time, settles Invalid at 0.50 per share. Nothing stays stuck."],
  ["Markets are reviewed", "A curator signs off on the rules before a creator can publish. The contract checks the signature."],
  ["Nobody can take your claim", "Pausing stops new trades only. Claims, refunds and resolution keep working."],
  ["Rewards come from fees only", "Backers of a new market share part of its trading fees. Nothing is paid from anyone's deposit."],
];

/** The hero's background: a step line, the same seam as the mark, drawn once on load. */
function SeamLine() {
  const d = "M0 280H130V250H250V266H370V200H490V218H610V150H750V170H870V90H1000V110H1120V20H1200";
  return (
    <svg aria-hidden viewBox="0 0 1200 300" preserveAspectRatio="none" className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-24 w-full md:h-32">
      <path d={d} fill="none" stroke="var(--border)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <path
        d={d}
        pathLength={1}
        fill="none"
        stroke="var(--yes)"
        strokeWidth="2"
        strokeOpacity="0.55"
        vectorEffect="non-scaling-stroke"
        className="draw"
        style={{ "--len": 1, "--draw-dur": "2600ms", "--draw-delay": "500ms" } as CSSProperties}
      />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="space-y-28 md:space-y-36">
      {/* Hero */}
      <section className="relative isolate -mx-4 px-4 pb-32 pt-6 md:-mx-6 md:px-6 md:pb-44 md:pt-12">
        <SeamLine />
        <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div className="space-y-8">
            <LogoMark size={48} animate title="" />
            <h1 className="display text-[2.9rem] sm:text-6xl lg:text-[4.75rem]">
              <span className="line-in" style={{ "--i": 0 } as CSSProperties}>
                Trade <span className="text-yes-text">Yes</span> or No
              </span>{" "}
              <span className="line-in" style={{ "--i": 1 } as CSSProperties}>on what happens next.</span>
            </h1>
            <p className="rise-in max-w-[34rem] text-lg text-ink-2" style={{ "--i": 0 } as CSSProperties}>
              Questions with public rules, priced by the people trading them. Every Yes and No pair is backed by exactly 1 MUSD,
              and every outcome sits in a public challenge window before anyone is paid.
            </p>
            <div className="rise-in flex flex-wrap gap-3" style={{ "--i": 1 } as CSSProperties}>
              <ButtonLink href="/markets" size="lg" variant="primary">
                Browse markets <ArrowRight className="size-4" />
              </ButtonLink>
              <ButtonLink href="/suggest" size="lg" variant="secondary">Suggest a market</ButtonLink>
            </div>
            <div className="rise-in" style={{ "--i": 2 } as CSSProperties}>
              <HeroCounts />
            </div>
          </div>
          <div className="rise-in" style={{ "--i": 2 } as CSSProperties}>
            <HeroTicket />
          </div>
        </div>
      </section>

      {/* Board */}
      <section aria-labelledby="board" className="reveal space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2">
            <h2 id="board" className="display text-4xl md:text-5xl">Open markets</h2>
            <p className="max-w-xl text-ink-2">Ranked by real trading in the last 24 hours. Pick a side straight from the board.</p>
          </div>
          <Link href="/markets" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
            All markets <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <Board />
      </section>

      {/* One MUSD, two sides */}
      <section aria-labelledby="backed" className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-20">
        <div className="reveal space-y-8">
          <div className="space-y-4">
            <h2 id="backed" className="display text-4xl md:text-5xl">One MUSD, two sides.</h2>
            <p className="max-w-lg text-ink-2">
              Every MUSD that enters a market becomes one Yes share and one No share. Exactly one side pays out, so the contract
              always holds enough to pay every winner. Nobody, including the protocol owner, can withdraw it.
            </p>
          </div>
          <div aria-hidden className="flex flex-wrap items-center gap-6 py-4">
            <div className="relative grid size-40 shrink-0 sm:size-48">
              <div className="split-no flex items-start justify-start rounded-t-md bg-no p-3 text-sm font-semibold text-on-no [clip-path:polygon(0_0,100%_0,100%_50%,68.75%_50%,68.75%_34.4%,28.1%_34.4%,28.1%_56.25%,0_56.25%)] [grid-area:1/1]">
                No
              </div>
              <div className="split-yes flex items-end justify-end rounded-b-md bg-yes p-3 text-sm font-semibold text-on-yes [clip-path:polygon(0_62.5%,34.4%_62.5%,34.4%_40.6%,62.5%_40.6%,62.5%_56.25%,100%_56.25%,100%_100%,0_100%)] [grid-area:1/1]">
                Yes
              </div>
            </div>
            <div className="space-y-1">
              <p className="mono text-4xl font-medium">1 MUSD</p>
              <p className="text-sm text-muted">= 1 Yes + 1 No</p>
            </div>
          </div>
        </div>
        <div className="reveal">
          <PayoutExample />
        </div>
      </section>

      {/* Lifecycle */}
      <section aria-labelledby="how" className="grid gap-10 lg:grid-cols-[1fr_1.3fr] lg:gap-20">
        <div className="space-y-4 lg:sticky lg:top-28 lg:self-start">
          <h2 id="how" className="display text-4xl md:text-5xl">How a market runs</h2>
          <p className="max-w-md text-ink-2">
            Six stages, all on-chain. Nobody can change the rules once trading starts, and nobody can take a claim you have earned.
          </p>
          <ButtonLink href="/docs" variant="ghost" className="-ml-4">
            Read the details <ArrowUpRight className="size-4" />
          </ButtonLink>
        </div>
        <ol className="relative">
          <span aria-hidden className="absolute bottom-6 left-[0.9375rem] top-6 w-px bg-line" />
          <span aria-hidden className="reveal-line absolute bottom-6 left-[0.9375rem] top-6 w-px bg-yes" />
          {LIFECYCLE.map(([t, b], i) => (
            <li key={t} className="reveal relative grid grid-cols-[2rem_1fr] gap-5 pb-10 last:pb-0">
              <span className="mono relative z-10 flex size-8 items-center justify-center rounded-full border border-line bg-bg text-xs font-medium text-ink-2">
                {i + 1}
              </span>
              <div className="space-y-1.5 pt-1">
                <h3 className="text-lg font-medium">{t}</h3>
                <p className="max-w-lg text-ink-2">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* What you can verify */}
      <section aria-labelledby="verify" className="space-y-10">
        <h2 id="verify" className="display reveal max-w-2xl text-4xl md:text-5xl">You don&apos;t have to trust us. You can check.</h2>
        <dl className="grid gap-x-12 md:grid-cols-2">
          {VERIFY.map(([t, b]) => (
            <div key={t} className="reveal grid gap-2 border-t border-line py-6 sm:grid-cols-[14rem_1fr] sm:gap-6">
              <dt className="font-medium">{t}</dt>
              <dd className="text-ink-2">{b}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Suggest */}
      <section className="reveal relative overflow-hidden rounded-lg bg-no px-6 py-12 text-on-no md:px-12 md:py-16 dark:border dark:border-line dark:bg-surface dark:text-ink">
        <div className="relative grid gap-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div className="space-y-5">
            <h2 className="display text-4xl md:text-5xl">Have a question worth a market?</h2>
            <p className="max-w-lg opacity-75">
              Write rules a stranger could check and submit them. A curator reviews in public, with reasons. Once published, the
              market opens for backers and goes live when both sides are funded.
            </p>
            <div className="flex flex-wrap gap-3">
              <ButtonLink href="/suggest" size="lg" variant="primary">
                Suggest a market <ArrowRight className="size-4" />
              </ButtonLink>
              <Link
                href="/proposals"
                className="press inline-flex h-12 items-center gap-2 rounded-md px-5 text-[0.9375rem] font-medium opacity-80 transition-opacity hover:opacity-100"
              >
                See the review queue
              </Link>
            </div>
          </div>
          <div aria-hidden className="hidden justify-self-end lg:block">
            <svg viewBox="0 0 64 64" className="size-56 opacity-90">
              <path d="M0 0H64V32H44V22H18V36H0Z" fill="none" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1" pathLength={1} className="draw" style={{ "--len": 1 } as CSSProperties} />
              <path d="M0 64H64V36H40V26H22V40H0Z" fill="var(--yes)" />
            </svg>
          </div>
        </div>
        <p className="relative mt-10 text-xs opacity-60">
          {deployment.ready
            ? `Running on ${deployment.isLocalFork ? "a local fork of Mezo Testnet" : deployment.chain.name}. Built on Mezo, settled in MUSD.`
            : "The market contract isn't deployed on this network yet."}
        </p>
      </section>
    </div>
  );
}
