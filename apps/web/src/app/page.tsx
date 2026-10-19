import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { LogoMark } from "@/components/brand/Logo";
import { ButtonLink } from "@/components/ui/Button";
import { deployment } from "@/lib/chain/config";
import { FeaturedMarkets } from "./FeaturedMarkets";

export default function Home() {
  return (
    <div className="space-y-24">
      <section className="grid gap-12 pt-4 lg:grid-cols-[1.1fr_1fr] lg:items-center lg:pt-10">
        <div className="space-y-6">
          <h1 className="max-w-xl text-4xl font-semibold leading-[1.05] md:text-[3.5rem]">Turn your conviction into a market.</h1>
          <p className="max-w-lg text-lg text-ink-2">
            Trade Yes or No on what happens next, with MUSD on Mezo. Rules are locked on-chain when a market opens, and every
            outcome goes through a public challenge window before anyone gets paid.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/discover" size="lg">Explore markets</ButtonLink>
            <ButtonLink href="/create" size="lg" variant="secondary">Create a market</ButtonLink>
          </div>
          <p className="text-sm text-muted">
            {deployment.ready
              ? `Running on ${deployment.isLocalFork ? "a local fork of Mezo Testnet" : deployment.chain.name}.`
              : "The market contract isn't deployed on this network yet."}{" "}
            Independent project, not affiliated with Mezo.
          </p>
        </div>
        <FeaturedMarkets />
      </section>

      <section aria-labelledby="how" className="grid gap-10 lg:grid-cols-[1fr_2fr]">
        <h2 id="how" className="text-2xl font-semibold">How a market works</h2>
        <ol className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
          {[
            ["Buy a side", "Each Yes or No share costs between 0 and 1 MUSD. The price is the market's current estimate of the chance."],
            ["Change your mind", "Sell your shares back to the pool any time before trading closes. You get the current price, minus a 1% fee."],
            ["Outcome, then a challenge window", "After close, the market's resolver proposes the result with evidence. Anyone can challenge it by posting a bond."],
            ["Get paid", "Once final, each winning share redeems for exactly 1 MUSD. If a market is ruled invalid, every share redeems for 0.5."],
          ].map(([t, b], i) => (
            <li key={t} className="space-y-1.5">
              <p className="tnum text-sm font-semibold text-accent-text">{i + 1}</p>
              <h3 className="text-lg font-semibold">{t}</h3>
              <p className="text-ink-2">{b}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="example" className="grid gap-10 border-y border-line py-14 lg:grid-cols-[1fr_2fr]">
        <h2 id="example" className="text-2xl font-semibold">A worked example</h2>
        <div className="max-w-2xl space-y-3 text-ink-2">
          <p>
            A market asks whether BTC closes above $150,000 on 31 December. Yes trades at 0.40 MUSD. You spend 40 MUSD and receive about
            99 Yes shares (the price rises slightly as you buy, and the fee is 1%).
          </p>
          <p>
            If Yes wins, your 99 shares redeem for 99 MUSD. If No wins, they are worth nothing. If the question turns out to be
            unresolvable, the market is ruled invalid and they redeem for 49.5 MUSD.
          </p>
          <p className="text-sm text-muted">Illustrative numbers, not a live market.</p>
        </div>
      </section>

      <section aria-labelledby="trust" className="grid gap-10 lg:grid-cols-[1fr_2fr]">
        <h2 id="trust" className="text-2xl font-semibold">What you can check yourself</h2>
        <ul className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
          <li>
            <h3 className="font-semibold text-ink">Every share is fully backed</h3>
            <p className="mt-1 text-ink-2">Each Yes and No pair is backed by exactly 1 MUSD held by the contract. Payouts can&apos;t exceed what&apos;s there.</p>
          </li>
          <li>
            <h3 className="font-semibold text-ink">Rules can&apos;t be edited</h3>
            <p className="mt-1 text-ink-2">A market&apos;s rules are hashed into the contract at creation. The page shows whether they still match.</p>
          </li>
          <li>
            <h3 className="font-semibold text-ink">Outcomes can be challenged</h3>
            <p className="mt-1 text-ink-2">Proposals, challenges and rulings all carry evidence and a transaction you can open on the explorer.</p>
          </li>
          <li>
            <h3 className="font-semibold text-ink">Nobody can take your claim</h3>
            <p className="mt-1 text-ink-2">Pausing stops new trades only. Claims, refunds and resolution keep working. There is no admin withdrawal of user funds.</p>
          </li>
        </ul>
      </section>

      <section className="flex flex-col items-start gap-6 rounded-lg bg-primary px-6 py-10 text-on-primary md:flex-row md:items-center md:justify-between md:px-10">
        <div className="flex items-center gap-4">
          <LogoMark size={44} variant="icon" aria-hidden title="" />
          <div>
            <h2 className="text-2xl font-semibold">Have a question worth a market?</h2>
            <p className="opacity-80">Write clear rules, seed the pool with MUSD, and earn half of the trading fees.</p>
          </div>
        </div>
        <Link href="/create" className="inline-flex h-12 items-center gap-2 rounded-md bg-on-primary px-5 font-semibold text-primary hover:opacity-90">
          Create a market <ArrowRight className="size-4" />
        </Link>
      </section>
    </div>
  );
}
