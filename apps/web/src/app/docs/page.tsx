import type { Metadata } from "next";
import Link from "next/link";
import { Address } from "@/components/ui/Address";
import { deployment, readinessMessage, TESTNET_FUNDING } from "@/lib/chain/config";
import { LiveParams } from "./LiveParams";

export const metadata: Metadata = { title: "How it works" };

const TOC = [
  ["how", "How a market works"],
  ["musd", "MUSD"],
  ["pricing", "Prices and payouts"],
  ["resolution", "Resolution and disputes"],
  ["fees", "Fees and parameters"],
  ["creators", "Creating a market"],
  ["policy", "Market policy"],
  ["risks", "Risks"],
  ["contracts", "Contracts and trust"],
  ["api", "Public data API"],
] as const;

function H({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 border-t border-line pt-10 text-2xl font-semibold">
      {children}
    </h2>
  );
}

export default function DocsPage() {
  return (
    <div className="grid gap-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
      <nav aria-label="On this page" className="hidden lg:sticky lg:top-24 lg:block lg:self-start">
        <ul className="space-y-1.5 text-sm">
          {TOC.map(([id, t]) => (
            <li key={id}><a href={`#${id}`} className="text-ink-2 hover:text-ink">{t}</a></li>
          ))}
        </ul>
      </nav>
      <article className="min-w-0 max-w-[70ch] space-y-6 text-ink-2 [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:text-ink [&_li]:pl-1 [&_strong]:text-ink">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold text-ink">How MEZONK works</h1>
          <p>
            MEZONK is an independent prediction market on Mezo. You trade Yes or No on questions with clear rules, using MUSD. This page
            covers how prices, payouts, resolution and fees work, and what the risks are.
          </p>
        </header>

        <H id="how">How a market works</H>
        <ol className="list-decimal space-y-2 pl-5">
          <li><strong>Someone creates a market</strong> with a yes/no question, exact rules, a source, and a close time. They seed the pool with MUSD.</li>
          <li><strong>You buy Yes or No shares.</strong> A share&apos;s price is between 0 and 1 MUSD and reflects the market&apos;s current estimate of the chance.</li>
          <li><strong>You can sell back</strong> to the pool any time before trading closes.</li>
          <li><strong>After close, the outcome is proposed</strong> by the market&apos;s resolver, with evidence. Anyone can challenge it during the challenge window.</li>
          <li><strong>Once final, winning shares redeem for 1 MUSD each.</strong> No deadline to claim.</li>
        </ol>

        <H id="musd">MUSD</H>
        <p>
          MUSD is Mezo&apos;s Bitcoin-backed stablecoin. You mint it by borrowing against BTC on Mezo. MEZONK accepts only the official MUSD
          contract for {deployment.chain.name}: <Address address={deployment.musd} label="MUSD" />. The address is fixed in the contract
          and never looked up by token symbol.
        </p>
        {deployment.chain.testnet && (
          <p>
            On testnet: get BTC for gas from the <a className="underline" href={TESTNET_FUNDING.btcFaucet} target="_blank" rel="noreferrer">Mezo faucet</a>,
            then <a className="underline" href={TESTNET_FUNDING.borrowMusd} target="_blank" rel="noreferrer">borrow MUSD</a>. {TESTNET_FUNDING.minBorrowNote}{" "}
            Testnet MUSD has no cash value.
          </p>
        )}

        <H id="pricing">Prices and payouts</H>
        <p>
          Each market runs an automated pool holding Yes and No shares. Every Yes/No pair is backed by exactly 1 MUSD in the contract.
          When you buy Yes, your MUSD mints new pairs; the pool keeps the No half and gives you Yes shares. Buying pushes the Yes price up,
          so large trades get a worse average price. The trade panel shows the average price, the price impact and the minimum you&apos;ll accept.
        </p>
        <h3>What a share pays</h3>
        <ul className="list-disc space-y-1 pl-5">
          <li>Your side wins: <strong>1 MUSD per share</strong>.</li>
          <li>Your side loses: 0.</li>
          <li>The market is ruled <strong>Invalid</strong>: <strong>0.5 MUSD per share</strong> of either side.</li>
        </ul>
        <p>
          Example: Yes costs 0.40. You spend 40 MUSD and get about 99 shares after the fee and price movement. If Yes wins, they pay 99 MUSD.
          If No wins, they pay nothing. If Invalid, 49.5 MUSD.
        </p>

        <H id="resolution">Resolution and disputes</H>
        <ol className="list-decimal space-y-2 pl-5">
          <li>Trading closes at the time set at creation. Closing doesn&apos;t decide anything.</li>
          <li>The market&apos;s <strong>resolver</strong> proposes Yes, No or Invalid within the proposal window. The proposal includes a hash of a published evidence document and posts a bond.</li>
          <li>During the <strong>challenge window</strong>, anyone except the resolver can challenge by posting a bond with their own evidence. One challenge per proposal.</li>
          <li>If nobody challenges, anyone can finalize the proposal once the window ends.</li>
          <li>If challenged, the market&apos;s <strong>arbitrator</strong> rules, with a published rationale, before its deadline. The losing side&apos;s bond goes to the winner.</li>
          <li>If the resolver never proposes, or the arbitrator never rules, anyone can finalize the market as <strong>Invalid</strong>, and bonds are refunded. Funds never get stuck.</li>
        </ol>
        <p>
          Every step is a public transaction, and every market page shows the full evidence trail with each document checked against the hash
          committed on-chain. The arbitrator is today a single address and is the main point of trust. See the{" "}
          <a className="underline" href="https://github.com/prajalsharma/mezonk/blob/main/docs/RESOLUTION_DESIGN.md" target="_blank" rel="noreferrer">resolution design</a>.
        </p>

        <H id="fees">Fees and parameters</H>
        <p>These are the live values for markets created now. Each market keeps the values it was created with.</p>
        {deployment.ready ? <LiveParams /> : <p className="text-warn">{readinessMessage[deployment.reason]}</p>}
        <p>Claiming payouts, refunds and bonds is free apart from the network fee.</p>

        <H id="creators">Creating a market</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>Write a question with a number or date, and rules a stranger would apply the same way.</li>
          <li>Rules are hashed on-chain and can never be edited, so ambiguity hurts everyone.</li>
          <li>You seed the pool. Your liquidity trades against everyone: at settlement you withdraw what the pool holds at the final rate, which can be less than you deposited.</li>
          <li>You earn the creator share of every trading fee, claimable at any time.</li>
        </ul>
        <p><Link className="font-semibold text-ink underline" href="/create">Create a market</Link></p>

        <H id="policy">Market policy</H>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Not allowed:</strong> markets on violence, death or harm to people; markets about private individuals; markets that could reward illegal acts.</li>
          <li><strong>Must be resolvable:</strong> questions without a public, checkable source should not be created. Ambiguous markets should resolve Invalid.</li>
          <li><strong>Deficient rules:</strong> markets without MEZONK&apos;s structured rules are flagged. Policy is that the resolver proposes Invalid unless the text decides it unambiguously.</li>
          <li><strong>Insider information and manipulation:</strong> don&apos;t trade on non-public information you have a duty to protect, and don&apos;t create markets on outcomes you control.</li>
          <li><strong>Access:</strong> you are responsible for whether prediction markets are legal where you live.</li>
        </ul>
        <p>The contract is permissionless, so this policy is enforced in this app (creation checks, flags) and through resolution, not by the contract itself.</p>

        <H id="risks">Risks</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>You can lose everything you put into a position. Prices are estimates, not guarantees.</li>
          <li>Outcomes depend on the resolver, challengers and the arbitrator acting honestly and on time.</li>
          <li>The contracts are <strong>not audited</strong>. Bugs could lose funds.</li>
          <li>MUSD is a stablecoin with its own risks. Mezo is a young network.</li>
          <li>Thin markets move a lot on small trades; check the price impact before you confirm.</li>
          <li>Nothing on MEZONK is financial advice.</li>
        </ul>

        <H id="contracts">Contracts and trust</H>
        <dl className="space-y-1">
          <div className="flex flex-wrap justify-between gap-2"><dt>Network</dt><dd className="text-ink">{deployment.isLocalFork ? `Local fork of ${deployment.chain.name}` : deployment.chain.name} (chain {deployment.chainId})</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>Market contract</dt><dd>{deployment.marketsAddress ? <Address address={deployment.marketsAddress} label="Contract" /> : "Not deployed"}</dd></div>
          <div className="flex flex-wrap justify-between gap-2"><dt>Collateral</dt><dd><Address address={deployment.musd} label="MUSD" /></dd></div>
        </dl>
        <ul className="list-disc space-y-1 pl-5">
          <li>No upgrade mechanism. The code you can read is the code that runs.</li>
          <li>The owner can approve resolvers, change parameters for <em>future</em> markets, pause new markets and trading, and withdraw the protocol&apos;s fee share. The owner <strong>cannot</strong> move your MUSD, change outcomes, or block claims.</li>
          <li>Pausing never stops resolution, claims or bond withdrawals.</li>
          <li>The website reads balances and claimable amounts straight from the contract, so you can still exit if MEZONK&apos;s servers are down.</li>
          <li>Source: <a className="underline" href="https://github.com/prajalsharma/mezonk" target="_blank" rel="noreferrer">github.com/prajalsharma/mezonk</a>. <Link className="underline" href="/status">System status</Link>.</li>
        </ul>

        <H id="api">Public data API</H>
        <p>Other Mezo apps can read indexed MEZONK data. All responses are JSON; amounts are 18-decimal strings; errors use <code className="font-mono text-sm [overflow-wrap:anywhere]">{"{ error: { code, message } }"}</code>.</p>
        <ul className="list-disc space-y-1 pl-5 font-mono text-sm [overflow-wrap:anywhere]">
          <li>GET /api/markets?status=open&amp;sort=trending&amp;q=&amp;category=&amp;limit=&amp;offset=</li>
          <li>GET /api/markets/:id · /history · /activity</li>
          <li>GET /api/resolution/:id</li>
          <li>GET /api/portfolio/:address · /api/activity/:address</li>
          <li>GET /api/health · /api/indexer/status</li>
        </ul>
        <p>Trending score: 24h volume × √(1 + distinct traders in 24h), open markets with at least one trade in 24h. Indexed data is a copy; verify anything financial against the contract.</p>
      </article>
    </div>
  );
}
