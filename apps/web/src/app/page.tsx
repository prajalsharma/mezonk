import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { deployment, TESTNET_FUNDING } from "@/lib/chain/config";
import { LiveMarkets, Results } from "./HomeLive";
import { FundingCard } from "./landing/FundingCard";
import { HeroStack } from "./landing/HeroStack";
import { PayoutCalculator } from "./landing/PayoutCalculator";
import { TrustBand } from "./landing/TrustBand";

export default function Home() {
  return (
    <div className="grain space-y-28 md:space-y-40">
      {/* Hero: the product itself, not an illustration of it. */}
      <section className="relative isolate grid items-center gap-10 pt-4 md:pt-10 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
        <div aria-hidden className="hero-light pointer-events-none absolute inset-x-0 -top-40 bottom-0 -z-10" />
        <div className="space-y-8">
          <p className="rise-in text-xl font-medium tracking-tight text-ink-2 md:text-2xl">
            The first prediction market <span className="font-semibold text-ink">on Mezo</span>
          </p>
          <h1 className="display text-[3.1rem] sm:text-7xl lg:text-6xl xl:text-[4.25rem] 2xl:text-[4.6rem]">
            Call it right.
            <br />
            <span className="xl:whitespace-nowrap">Keep your bitcoin.</span>
          </h1>
          <p className="rise-in max-w-[31rem] text-xl leading-relaxed text-ink-2" style={{ "--i": 1 } as React.CSSProperties}>
            Borrow MUSD against your BTC on Mezo, back <span className="font-semibold text-yes-text">Yes</span> or{" "}
            <span className="font-semibold text-ink">No</span>, and get paid in MUSD when you&apos;re right.
          </p>
          <div className="rise-in flex flex-wrap gap-3" style={{ "--i": 2 } as React.CSSProperties}>
            <ButtonLink href="/markets" size="lg">
              Browse markets <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink href="/borrow" size="lg" variant="secondary">Borrow MUSD</ButtonLink>
          </div>
          {deployment.ready && deployment.chain.testnet && !deployment.isLocalFork && (
            <p className="rise-in text-[0.9375rem] text-ink-2" style={{ "--i": 3 } as React.CSSProperties}>
              <span aria-hidden className="pulse-dot mr-2 inline-block size-2 rounded-full bg-success align-middle" />
              Try it free: grab test BTC from the{" "}
              <a href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer" className="font-medium text-yes-text underline-offset-4 hover:underline">
                Mezo faucet
              </a>
              , borrow test MUSD, and make your first call.
            </p>
          )}
        </div>
        <HeroStack />
      </section>

      {/* Funding: one card, two answers. */}
      <section id="funding" aria-labelledby="funding-h" className="scroll-mt-28 space-y-10">
        <h2 id="funding-h" className="display text-center text-5xl md:text-6xl">Your bitcoin stays yours.</h2>
        <FundingCard />
      </section>

      {/* The board. */}
      <section aria-labelledby="markets" className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl space-y-2">
            <h2 id="markets" className="display text-4xl md:text-5xl">Make your call</h2>
            <p className="text-lg text-ink-2">
              Each share costs its price in cents and pays 1 MUSD if you&apos;re right. Every button shows what 10 MUSD turns into.
            </p>
          </div>
          <Link href="/markets" className="inline-flex items-center gap-1.5 font-medium text-ink-2 hover:text-ink">
            All markets <ArrowRight className="size-4" />
          </Link>
        </div>
        <LiveMarkets />
      </section>

      <Results />

      {/* Try a trade: drag the seam, see the payout. */}
      <section aria-labelledby="calc" className="space-y-10">
        <div className="max-w-2xl space-y-3">
          <h2 id="calc" className="display text-5xl md:text-6xl">Drag the line. See the payout.</h2>
          <p className="text-lg text-ink-2">Every winning share pays exactly 1 MUSD, so you know the upside before you buy.</p>
        </div>
        <PayoutCalculator />
      </section>

      <TrustBand />

      {/* Final call: a question box, not a slogan. Works without JavaScript (a plain GET form). */}
      <section aria-labelledby="ask" className="flex flex-col items-center gap-7 pb-8 text-center">
        <LogoMark size={56} title="" />
        <h2 id="ask" className="display max-w-3xl text-5xl md:text-6xl">Ask the question.</h2>
        <p className="max-w-xl text-lg text-ink-2">
          Write a yes/no question with rules a stranger could check. A curator reviews it in public, and backers decide if it goes live.
        </p>
        <form action="/suggest" method="get" className="float flex w-full max-w-xl items-center gap-2 p-2">
          <label htmlFor="ask-q" className="sr-only">Your question</label>
          <input
            id="ask-q"
            name="q"
            maxLength={160}
            placeholder="Will Mezo TVL pass $500M by 31 March?"
            className="h-12 min-w-0 flex-1 bg-transparent px-3 text-base text-ink placeholder:text-muted focus:outline-none"
          />
          <button type="submit" className="press inline-flex h-12 shrink-0 items-center gap-1.5 rounded-md bg-yes px-5 font-semibold text-on-yes hover:bg-accent-hover">
            Suggest <ArrowRight className="size-4" />
          </button>
        </form>
        <p className="text-sm text-muted">
          {!deployment.ready
            ? "Built on Mezo, settled in MUSD. Trading isn't switched on for this network yet."
            : deployment.isLocalFork
              ? "Built on Mezo, settled in MUSD. Running on a local fork of Mezo Testnet."
              : deployment.chain.testnet
                ? "Live on Mezo Testnet, settled in MUSD. Mainnet comes later."
                : `Built on Mezo, settled in MUSD. Live on ${deployment.chain.name}.`}
        </p>
      </section>
    </div>
  );
}
