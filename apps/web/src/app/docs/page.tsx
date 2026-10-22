import type { Metadata } from "next";
import Link from "next/link";
import { Address } from "@/components/ui/Address";
import { deployment, readinessMessage, TESTNET_FUNDING } from "@/lib/chain/config";
import { LiveParams } from "./LiveParams";

export const metadata: Metadata = {
  title: "How it works",
  description: "How MEZONK works: the simple version, getting started, markets, seeding, borrowing MUSD on Mezo, prices, resolution, fees and risks.",
};

/**
 * The docs. Written for two readers: someone new (the simple version, getting started, FAQ) and someone checking the
 * details (lifecycle, roles, seeding, prices, resolution, fees, contracts). Numbers that can change are read live from the
 * contracts in "Fees and parameters"; the worked examples say which settings they assume.
 */
const TOC = [
  ["simple", "The simple version"],
  ["start", "Getting started"],
  ["roles", "Who does what"],
  ["lifecycle", "A market, start to finish"],
  ["seeding", "Seeding and launch"],
  ["borrow", "MUSD and borrowing on Mezo"],
  ["pricing", "Prices, orders and payouts"],
  ["resolution", "Resolution and disputes"],
  ["fees", "Fees and parameters"],
  ["creators", "Suggesting a market"],
  ["policy", "Market policy"],
  ["faq", "Questions"],
  ["risks", "Risks"],
  ["contracts", "Contracts and trust"],
  ["api", "Public data API"],
] as const;

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 border-t border-line pt-10 text-2xl font-semibold text-ink">
      {children}
    </h2>
  );
}

function Q({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <details className="group border-b border-line py-4 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 font-medium text-ink">
        {q}
        <span aria-hidden className="mt-0.5 text-muted transition-transform duration-200 group-open:rotate-45">+</span>
      </summary>
      <div className="mt-3 space-y-2">{children}</div>
    </details>
  );
}

const ROLES: Array<[string, string, string]> = [
  ["Anyone", "Suggests a question", "Nothing. A suggestion is free."],
  ["Curator", "Reviews suggestions and approves good ones by signing them", "Nothing. Approval is a free wallet signature."],
  ["Creator", "Publishes an approved market on-chain, which starts seeding", "Only the network fee."],
  ["Seeders (backers)", "Put real buy orders on both sides so the market has prices on day one", "Their own MUSD, locked in the contract. Refunded in full if the market never launches."],
  ["Traders", "Buy and sell Yes and No", "Their own MUSD."],
  ["Resolver", "Proposes the result after close, with evidence", "A bond, returned if nobody proves them wrong."],
  ["Anyone", "Challenges a wrong result", "A bond, returned (plus the resolver's) if they're right."],
  ["Arbitrator", "Rules on challenged results, in public", "Nothing."],
  ["Owner", "Sets rules for future markets, can pause new markets and trading", "Nothing. Can't touch your MUSD or change a result."],
];

export default function DocsPage() {
  const testnet = !!deployment.chain.testnet && !deployment.isLocalFork;
  return (
    <div className="grid gap-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="On this page" className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
        <ul className="space-y-1.5 text-sm">
          {TOC.map(([id, t]) => (
            <li key={id}>
              <a href={`#${id}`} className="text-ink-2 hover:text-ink">{t}</a>
            </li>
          ))}
        </ul>
      </nav>

      <article className="min-w-0 max-w-[72ch] space-y-6 text-ink-2 [&_h3]:pt-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink [&_li]:pl-1 [&_strong]:text-ink">
        <header className="space-y-3">
          <h1 className="display text-5xl text-ink md:text-6xl">How MEZONK works</h1>
          <p className="text-lg">
            MEZONK is a prediction market on Mezo. You back Yes or No on a question with clear rules, using MUSD, and you&apos;re paid in
            MUSD when you&apos;re right. Holding BTC instead? Borrow MUSD against it on Mezo and keep your bitcoin.
          </p>
          {testnet && (
            <p className="rounded-md border border-line bg-surface px-4 py-3 text-[0.9375rem]">
              <span aria-hidden className="pulse-dot mr-2 inline-block size-2 rounded-full bg-success align-middle" />
              <strong>Live on Mezo Testnet.</strong> Everything here uses test BTC and test MUSD, which have no cash value. It&apos;s the
              real product, so you can learn it without risking money.
            </p>
          )}
          {/* Phones don't get the side menu, so the contents sit here. */}
          <details className="rounded-md border border-line bg-surface px-4 py-3 lg:hidden">
            <summary className="cursor-pointer font-medium text-ink">On this page</summary>
            <ul className="mt-3 grid gap-1.5 text-[0.9375rem] sm:grid-cols-2">
              {TOC.map(([id, t]) => (
                <li key={id}><a href={`#${id}`} className="hover:text-ink">{t}</a></li>
              ))}
            </ul>
          </details>
        </header>

        {/* ---------------- ELI5 ---------------- */}
        <H id="simple">The simple version</H>
        <p>If you&apos;ve never used a prediction market, start here. No jargon.</p>

        <div className="space-y-5 rounded-lg border border-line bg-surface p-6">
          <div className="space-y-2">
            <h3>1. A question with two tickets</h3>
            <p>
              Picture a question like <em>&ldquo;Will it rain in London on Saturday?&rdquo;</em> For every question there are two kinds of
              ticket: a <span className="font-semibold text-yes-text">Yes</span> ticket and a <strong>No</strong> ticket. When the answer is
              known, every winning ticket is worth exactly <strong>1 MUSD</strong> (about one dollar). Losing tickets are worth nothing.
            </p>
          </div>
          <div className="space-y-2">
            <h3>2. The price is the crowd&apos;s guess</h3>
            <p>
              Tickets cost between 1¢ and 99¢. If Yes tickets sell for 70¢, people think rain is quite likely, about a 70% chance. If you think
              they&apos;re wrong and it will stay dry, No tickets are cheap at 30¢, and each pays 1 MUSD if you&apos;re right. That&apos;s
              more than three times your money.
            </p>
          </div>
          <div className="space-y-2">
            <h3>3. The dollar is already in the jar</h3>
            <p>
              A Yes ticket and a No ticket are always made together, and together they cost exactly 1 MUSD. That 1 MUSD goes into a locked
              jar (the smart contract) and stays there. When the answer comes in, the jar pays whoever holds the winning ticket. So winners are
              paid from money that was put aside the moment the tickets were made. MEZONK never pays winners out of its own pocket, and
              never bets against you.
            </p>
          </div>
          <div className="space-y-2">
            <h3>4. You trade with other people</h3>
            <p>
              You buy tickets from people selling them, and you can sell yours before the question closes, maybe at a profit if the crowd
              comes round to your view.
            </p>
          </div>
          <div className="space-y-2">
            <h3>5. Someone checks the answer, in public</h3>
            <p>
              After the question closes, a resolver says what happened and shows the evidence. Anyone who disagrees has time to challenge
              it, and a referee (the arbitrator) decides. If the question can&apos;t be answered fairly, every ticket pays back half: 0.50 MUSD.
            </p>
          </div>
          <div className="space-y-2">
            <h3>6. Got bitcoin but no MUSD? Borrow, don&apos;t sell</h3>
            <p>
              Think of it like leaving your bitcoin in a locker at Mezo and getting a loan in MUSD against it. Your bitcoin isn&apos;t sold;
              it&apos;s still yours. Trade with the MUSD, then pay the loan back whenever you like, and the locker opens. The one rule:
              if bitcoin&apos;s price falls a lot, the locker can be emptied to cover the loan, so don&apos;t borrow too much.
            </p>
          </div>
          <div className="space-y-2">
            <h3>7. Why would a market have prices on day one?</h3>
            <p>
              Before a new question opens for trading, some people (seeders) put up real orders with their own MUSD on both sides: &ldquo;I&apos;ll
              buy Yes at 45¢&rdquo; and &ldquo;I&apos;ll buy No at 45¢.&rdquo; Once there&apos;s enough on both sides, the market opens with
              prices already there. If not enough people seed it within the time limit, it never opens and they all get their MUSD back.
            </p>
          </div>
        </div>
        <p>
          That&apos;s the whole idea. Everything below is the detail: exact rules, numbers, and how to check them yourself.
        </p>

        {/* ---------------- Getting started ---------------- */}
        <H id="start">Getting started</H>
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            <strong>Get a wallet.</strong> Any Ethereum-style wallet works (MetaMask, Rabby, Coinbase Wallet…). Click <em>Connect wallet</em>;
            the site will ask to add and switch to {deployment.chain.name}.
          </li>
          <li>
            <strong>Get BTC for fees.</strong> On Mezo, BTC is what you pay network fees with.
            {testnet && (
              <>
                {" "}On testnet it&apos;s free from the{" "}
                <a className="underline" href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer">Mezo faucet</a>.
              </>
            )}
          </li>
          <li>
            <strong>Get MUSD.</strong> If you already have MUSD, skip this. If you have BTC, open{" "}
            <Link className="underline" href="/borrow">Borrow MUSD</Link>, lock some BTC and borrow MUSD against it. Mezo&apos;s smallest
            loan is about 1,800 MUSD, so you&apos;ll need roughly 0.05 BTC or more.
          </li>
          <li>
            <strong>Pick a market and a side.</strong> On a market page, enter how much MUSD to spend and press <em>Buy Yes</em> or{" "}
            <em>Buy No</em>. The first time, your wallet asks you to approve MUSD spending (one exact amount), then to confirm the trade.
          </li>
          <li>
            <strong>Watch it, or sell early.</strong> Your positions and their current value are in{" "}
            <Link className="underline" href="/portfolio">Portfolio</Link>.
          </li>
          <li>
            <strong>Claim.</strong> When the market is final, press <em>Claim</em> on the market page or in Portfolio. There&apos;s no deadline.
          </li>
          <li>
            <strong>Repay your loan when you like.</strong> If you borrowed, repay on Mezo to unlock your BTC. There&apos;s no due date.
          </li>
        </ol>

        {/* ---------------- Roles ---------------- */}
        <H id="roles">Who does what</H>
        <p>
          A market passes through several hands. Only seeders, traders and people posting bonds put money in, and that money always sits in
          the contract.
        </p>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[34rem] text-left text-[0.9375rem]">
            <thead className="bg-surface-2 text-ink">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-semibold">Who</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Does</th>
                <th scope="col" className="px-4 py-2.5 font-semibold">Puts in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ROLES.map(([who, does, puts], i) => (
                <tr key={i} className="align-top">
                  <th scope="row" className="px-4 py-3 font-medium text-ink">{who}</th>
                  <td className="px-4 py-3">{does}</td>
                  <td className="px-4 py-3">{puts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          Curators, creators, resolvers and arbitrators are wallets approved on-chain. The curator can never publish a market they approved,
          and the arbitrator must be a different wallet from the resolver.
        </p>

        {/* ---------------- Lifecycle ---------------- */}
        <H id="lifecycle">A market, start to finish</H>
        <ol className="list-decimal space-y-3 pl-5">
          <li><strong>Suggested.</strong> Someone writes the question, the rules (what counts as Yes, No and Invalid), the source to check, and the close time.</li>
          <li><strong>Reviewed and approved.</strong> A curator checks it against the policy. Every decision and reason is public on the suggestion&apos;s page. Approval is the curator&apos;s signature.</li>
          <li><strong>Published (seeding).</strong> An approved creator puts it on-chain. The rules are fingerprinted on-chain at this moment and can never be edited. Nobody can trade yet.</li>
          <li><strong>Seeded.</strong> Seeders place funded orders on both sides (see the next section).</li>
          <li><strong>Live.</strong> Once the contract sees enough on both sides, anyone can press <em>Launch</em>. Trading opens. If the seeding deadline passes first, the market fails and every seeder is refunded.</li>
          <li><strong>Closed.</strong> Trading stops at the close time. Closing decides nothing.</li>
          <li><strong>Proposed.</strong> The resolver proposes Yes, No or Invalid, with an evidence document whose fingerprint is stored on-chain, and posts a bond.</li>
          <li><strong>Challenged (maybe).</strong> Anyone can challenge during the challenge window with their own bond and evidence. The arbitrator then rules, publicly.</li>
          <li><strong>Final.</strong> Winning shares redeem for 1 MUSD; Invalid pays 0.50 per share. Claims never expire.</li>
        </ol>

        {/* ---------------- Seeding ---------------- */}
        <H id="seeding">Seeding and launch</H>
        <p>
          A new market starts with an empty order book. Seeding fills it with real, funded orders before anyone trades, so the first trader
          finds real prices instead of nothing.
        </p>
        <h3>Where the money comes from</h3>
        <p>
          From the seeders&apos; own wallets. Anyone can seed, including the creator. The curator doesn&apos;t put money in. A seed order is
          an ordinary buy order (&ldquo;buy 100 Yes at 45¢&rdquo;) whose MUSD is locked in the contract. Buying No at 45¢ is the same as
          offering Yes at 55¢, so seed orders on both sides form a book with a price range.
        </p>
        <h3>When it can launch</h3>
        <p>The contract checks all of this itself, from the MUSD locked in it, in the same transaction that launches the market:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>There are orders on both sides, and the gap between the best Yes and best No price is small enough.</li>
          <li>Enough shares are on offer close to the best prices on each side.</li>
          <li>Enough different wallets have seeded, each with at least a minimum amount.</li>
          <li>The seeding deadline hasn&apos;t passed.</li>
        </ul>
        <p>The exact numbers for new markets are in <a className="underline" href="#fees">Fees and parameters</a>, read live from the contract.</p>
        <h3>Worked example (today&apos;s testnet settings)</h3>
        <p>
          The current policy asks for 100 shares within 5¢ of the best price on each side, a gap of at most 10¢, and at least two seeders with
          10 MUSD or more each. One way to meet it:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Wallet A: buy 100 Yes at 45¢, which locks <strong>45 MUSD</strong>.</li>
          <li>Wallet B: buy 100 No at 45¢ (that is, offer Yes at 55¢), which locks <strong>45 MUSD</strong>.</li>
          <li>Gap: 55¢ − 45¢ = 10¢. Two seeders. The market can launch with about <strong>90 MUSD</strong> in total.</li>
        </ul>
        <h3>What seeders get, and risk</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>If the market never launches:</strong> a full refund, nothing lost but network fees.</li>
          <li><strong>Once it launches:</strong> seed orders become normal orders. If a trader fills yours, you hold that side and win or lose like anyone else.</li>
          <li><strong>A share of fees:</strong> for a while after launch, part of every trading fee goes to the market&apos;s seeders, by how much each seeded. It&apos;s paid only from fees actually collected, capped per wallet, and claimable for a limited time after the reward period. It isn&apos;t interest and isn&apos;t guaranteed.</li>
          <li><strong>Lock:</strong> seed orders can&apos;t be cancelled for a short time after placing them, and again just after launch, so the liquidity that launched the market is really there.</li>
        </ul>

        {/* ---------------- Borrow ---------------- */}
        <H id="borrow">MUSD and borrowing on Mezo</H>
        <p>
          MUSD is Mezo&apos;s bitcoin-backed dollar. Every MEZONK trade and payout is in MUSD. MEZONK accepts only the official MUSD contract
          for {deployment.chain.name}: <Address address={deployment.musd} label="MUSD" />. It&apos;s fixed in the contract and never looked
          up by name.
        </p>
        <h3>Borrowing MUSD against BTC</h3>
        <p>
          <Link className="underline" href="/borrow">Borrow MUSD</Link> opens a loan with Mezo&apos;s own lending contracts, signed from your
          wallet. Your BTC goes into Mezo&apos;s contract, not to MEZONK. MEZONK never holds your bitcoin, never lends, and can&apos;t touch
          your loan. Before you sign, the page shows everything, read live from Mezo:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>BTC locked and MUSD received.</strong></li>
          <li><strong>One-time fee</strong> (currently 0.1%), added to what you owe.</li>
          <li><strong>Refundable deposit</strong> of 200 MUSD, added to what you owe and returned when you close the loan.</li>
          <li><strong>Interest</strong> (currently 1% a year), simple, with no repayment date.</li>
          <li><strong>Collateral ratio:</strong> your BTC&apos;s value divided by what you owe. Mezo&apos;s minimum is 110%; the page suggests 200% and warns below 150%.</li>
          <li><strong>Liquidation price:</strong> the BTC price at which your ratio would hit 110%. Below it, Mezo can liquidate the loan and you lose the locked BTC.</li>
        </ul>
        <p>
          Mezo&apos;s smallest loan is about 1,800 MUSD. You get one loan per wallet; if you already have one, the page lets you borrow more
          on it instead. Repaying, adding BTC or closing happens on Mezo&apos;s own site.
        </p>
        <h3>Redemptions, in one paragraph</h3>
        <p>
          Anyone holding MUSD can swap it with Mezo for BTC, taken from the loans with the lowest ratios first. If that hits your loan, your
          debt goes down by the same value as the BTC taken, so you don&apos;t lose money on paper, but you&apos;d hold less BTC. A higher
          ratio makes it less likely.
        </p>
        <p>
          Already hold MUSD? You don&apos;t need a loan at all. If you borrowed more than you&apos;ll trade, the borrow page lists other
          things you can do with MUSD on Mezo.
        </p>

        {/* ---------------- Pricing ---------------- */}
        <H id="pricing">Prices, orders and payouts</H>
        <p>
          Every Yes/No pair is backed by exactly 1 MUSD held by the exchange contract. Shares only come into existence when someone locks that
          MUSD: by splitting 1 MUSD into 1 Yes + 1 No, or when a Yes buyer at 60¢ and a No buyer at 40¢ are matched, together paying exactly 1 MUSD
          for a new pair. So every winning share is paid from money already in the contract.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Buying by amount (the default):</strong> say how much MUSD to spend; the ticket shows how many shares that buys at the prices on offer, and the fee, before you confirm.</li>
          <li><strong>Market order:</strong> fills now against the best offers, never past your price limit. Whatever can&apos;t fill at that price is cancelled.</li>
          <li><strong>Limit order:</strong> fills what it can now, and the rest waits on the book at your price. You choose to sign it (free, funds stay in your wallet) or escrow it on-chain (funds locked, always executable).</li>
          <li><strong>If everyone wants Yes</strong> and nobody offers it, nothing fills. The ticket says so; you can raise your limit or wait. No shares are invented.</li>
          <li><strong>Prices shown:</strong> the only number shown as a price is the last real trade. The middle of the book is labelled indicative. A market with no trades shows no number.</li>
        </ul>
        <h3>What a share pays</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your side wins: <strong>1 MUSD per share</strong>.</li>
          <li>Your side loses: 0.</li>
          <li>The market is ruled <strong>Invalid</strong>: <strong>0.50 MUSD per share</strong> of either side.</li>
        </ul>
        <p>
          Example: you buy 100 Yes at 40¢. You pay 40 MUSD plus the taker fee. If Yes wins, they pay 100 MUSD. If No wins, they pay nothing.
          If Invalid, 50 MUSD.
        </p>

        {/* ---------------- Resolution ---------------- */}
        <H id="resolution">Resolution and disputes</H>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Trading closes at the time set at creation. Closing doesn&apos;t decide anything.</li>
          <li>The market&apos;s <strong>resolver</strong> proposes Yes, No or Invalid within the proposal window. The proposal includes the fingerprint of a published evidence document and posts a bond.</li>
          <li>During the <strong>challenge window</strong>, anyone except the resolver can challenge by posting a bond with their own evidence. One challenge per proposal.</li>
          <li>If nobody challenges, anyone can finalize the proposal once the window ends.</li>
          <li>If challenged, the market&apos;s <strong>arbitrator</strong> rules, with a published rationale, before its deadline. The losing side&apos;s bond goes to the winner.</li>
          <li>If the resolver never proposes, or the arbitrator never rules, anyone can finalize the market as <strong>Invalid</strong>, and bonds are refunded. Funds never get stuck.</li>
        </ol>
        <p>
          Every step is a public transaction, and every market page shows the full evidence trail with each document checked against the
          fingerprint committed on-chain. The arbitrator is today a single address and is the main point of trust. See the{" "}
          <a className="underline" href="https://github.com/prajalsharma/mezonk/blob/main/docs/RESOLUTION_DESIGN.md" target="_blank" rel="noreferrer">resolution design</a>.
        </p>

        {/* ---------------- Fees ---------------- */}
        <H id="fees">Fees and parameters</H>
        <p>These are the live values for markets created now, read from the contracts. Each market keeps the values it was published with.</p>
        {deployment.ready ? <LiveParams /> : <p className="text-warn">{readinessMessage[deployment.reason]}</p>}
        <ul className="list-disc space-y-1 pl-5">
          <li>Only the taker (the order that fills immediately) pays the trading fee. Orders that wait on the book pay nothing.</li>
          <li>Claiming payouts, refunds and bonds is free apart from the network fee.</li>
          <li>Network fees on Mezo are paid in BTC and are tiny.</li>
        </ul>

        {/* ---------------- Creators ---------------- */}
        <H id="creators">Suggesting a market</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>Anyone with a wallet can suggest a market: a question with a number or date, and rules a stranger would apply the same way.</li>
          <li>Good questions name their source (&ldquo;Coinbase BTC-USD daily close&rdquo;), their time zone, and what happens in edge cases.</li>
          <li>A curator reviews it against the policy and a public checklist, and may ask for changes. Every decision and reason is public.</li>
          <li>Approval is a signature from the curator&apos;s wallet. The contract refuses to create a market without a valid, unused, unexpired one, and the curator can never be the publisher.</li>
          <li>An approved creator publishes it. That starts seeding; it doesn&apos;t make the market tradable, and the creator doesn&apos;t have to put up money.</li>
          <li>Referrers earn part of the fees paid by people they bring, from those people&apos;s real trades only, capped per market.</li>
          <li>Once published, rules are fingerprinted on-chain and can never be edited, so ambiguity hurts everyone.</li>
        </ul>
        <p>
          <Link className="font-semibold text-ink underline" href="/suggest">Suggest a market</Link>
          {" · "}
          <Link className="font-semibold text-ink underline" href="/proposals">See the review queue</Link>
        </p>

        {/* ---------------- Policy ---------------- */}
        <H id="policy">Market policy</H>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Not allowed:</strong> markets on violence, death or harm to people; markets about private individuals; markets that could reward illegal acts.</li>
          <li><strong>Must be resolvable:</strong> questions without a public, checkable source should not be created. Ambiguous markets should resolve Invalid.</li>
          <li><strong>Deficient rules:</strong> markets without MEZONK&apos;s structured rules are flagged. Policy is that the resolver proposes Invalid unless the text decides it unambiguously.</li>
          <li><strong>Insider information and manipulation:</strong> don&apos;t trade on non-public information you have a duty to protect, and don&apos;t create markets on outcomes you control.</li>
          <li><strong>Access:</strong> you are responsible for whether prediction markets are legal where you live.</li>
        </ul>
        <p>The contract is permissionless, so this policy is enforced in this app (creation checks, flags) and through resolution, not by the contract itself.</p>

        {/* ---------------- FAQ ---------------- */}
        <H id="faq">Questions</H>
        <div>
          <Q q="Who pays me when I win?">
            <p>The contract, from MUSD that was locked when the shares were created. Every Yes/No pair is backed by 1 MUSD the moment it exists. MEZONK doesn&apos;t pay winners and doesn&apos;t take the other side of your trade.</p>
          </Q>
          <Q q="Does the curator put up money to start a market?">
            <p>No. The curator only approves the question by signing it. Starting liquidity comes from seeders, who use their own MUSD and get it back in full if the market never launches. See <a className="underline" href="#seeding">Seeding and launch</a>.</p>
          </Q>
          <Q q="Can MEZONK take my MUSD or my BTC?">
            <p>No. Your MUSD sits in the exchange contract, which has no upgrade mechanism and no function that lets anyone move your funds. Your BTC, if you borrow, sits in Mezo&apos;s contract. The owner can pause new markets and trading, but never claims, refunds or resolution.</p>
          </Q>
          <Q q="What if I can't sell my shares?">
            <p>You can always hold them to the end and claim. Selling early needs a buyer; if the book is thin, the ticket tells you how much would fill before you confirm.</p>
          </Q>
          <Q q="What if the answer is unclear, or nobody resolves the market?">
            <p>Unclear questions should resolve Invalid, which pays 0.50 MUSD per share. If the resolver never proposes, or the arbitrator never rules, anyone can finalize the market as Invalid. Funds can&apos;t get stuck.</p>
          </Q>
          <Q q="What if a market never gets enough seeders?">
            <p>It fails at the seeding deadline. Nobody ever traded it, and every seeder takes back exactly what they locked.</p>
          </Q>
          <Q q="Do I have to borrow to use MEZONK?">
            <p>No. If you already hold MUSD, just trade. Borrowing is for people who hold BTC and don&apos;t want to sell it.</p>
          </Q>
          <Q q="What's the difference between testnet and mainnet?">
            <p>Testnet is the same product with test BTC and test MUSD, which have no cash value. It&apos;s for learning and testing. Mainnet uses real money and comes later.</p>
          </Q>
          <Q q="Is my wallet balance on this site real?">
            <p>The wallet panel reads balances straight from {deployment.chain.name}.{testnet ? " On testnet they're test tokens with no value." : ""}</p>
          </Q>
        </div>

        {/* ---------------- Risks ---------------- */}
        <H id="risks">Risks</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>You can lose everything you put into a position. Prices are the crowd&apos;s estimate, not a guarantee.</li>
          <li>Outcomes depend on the resolver, challengers and the arbitrator acting honestly and on time.</li>
          <li>The contracts are <strong>not audited</strong>. Bugs could lose funds.</li>
          <li><strong>Borrowing:</strong> if BTC falls far enough, Mezo can liquidate your loan and you lose the locked BTC. Interest keeps adding to what you owe. Redemptions can swap some of your BTC for debt.</li>
          <li>MUSD is a stablecoin with its own risks. Mezo is a young network.</li>
          <li>Thin books fill only partly: the ticket shows how much fills at your price before you confirm. Seeding can lose money once a market is live.</li>
          <li>Nothing on MEZONK is financial advice.</li>
        </ul>

        {/* ---------------- Contracts ---------------- */}
        <H id="contracts">Contracts and trust</H>
        <dl className="space-y-1">
          <div className="flex flex-wrap justify-between gap-2"><dt>Network</dt><dd className="text-ink">{deployment.isLocalFork ? `Local fork of ${deployment.chain.name}` : deployment.chain.name} (chain {deployment.chainId})</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>Exchange</dt><dd>{deployment.marketsAddress ? <Address address={deployment.marketsAddress} label="Exchange" /> : "Not deployed"}</dd></div>
          {deployment.factoryAddress && <div className="flex flex-wrap justify-between gap-2"><dt>Market factory</dt><dd><Address address={deployment.factoryAddress} label="Factory" /></dd></div>}
          {deployment.resolutionAddress && <div className="flex flex-wrap justify-between gap-2"><dt>Resolution</dt><dd><Address address={deployment.resolutionAddress} label="Resolution" /></dd></div>}
          {deployment.incentivesAddress && <div className="flex flex-wrap justify-between gap-2"><dt>Incentives</dt><dd><Address address={deployment.incentivesAddress} label="Incentives" /></dd></div>}
          <div className="flex flex-wrap justify-between gap-2"><dt>Collateral</dt><dd><Address address={deployment.musd} label="MUSD" /></dd></div>
        </dl>
        <ul className="list-disc space-y-1 pl-5">
          <li>No upgrade mechanism. The code you can read is the code that runs.</li>
          <li>The owner can approve resolvers and curators, change parameters for <em>future</em> markets, pause new markets and trading, and withdraw the protocol&apos;s fee share. The owner <strong>cannot</strong> move your MUSD, change outcomes, or block claims.</li>
          <li>Pausing never stops resolution, claims or bond withdrawals.</li>
          <li>The website reads balances and claimable amounts straight from the contract, so you can still exit if MEZONK&apos;s servers are down.</li>
          <li>Source: <a className="underline" href="https://github.com/prajalsharma/mezonk" target="_blank" rel="noreferrer">github.com/prajalsharma/mezonk</a>. <Link className="underline" href="/status">System status</Link>.</li>
        </ul>

        {/* ---------------- API ---------------- */}
        <H id="api">Public data API</H>
        <p>Other Mezo apps can read indexed MEZONK data. All responses are JSON; amounts are 18-decimal strings; errors use <code className="font-mono text-sm [overflow-wrap:anywhere]">{"{ error: { code, message } }"}</code>.</p>
        <ul className="list-disc space-y-1 pl-5 font-mono text-sm [overflow-wrap:anywhere]">
          <li>GET /api/markets?status=open&amp;sort=trending&amp;q=&amp;category=&amp;limit=&amp;offset=</li>
          <li>GET /api/markets/:id · /history · /activity</li>
          <li>GET /api/resolution/:id</li>
          <li>GET /api/portfolio/:address · /api/activity/:address</li>
          <li>GET /api/policies · /api/health · /api/indexer/status</li>
        </ul>
        <p>Trending score: 24h volume × √(1 + distinct traders in 24h), open markets with at least one trade in 24h. Indexed data is a copy; verify anything financial against the contract.</p>
      </article>
    </div>
  );
}
