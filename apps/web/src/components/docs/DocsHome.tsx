import Link from "next/link";
import { ArrowRight, Blocks, BookOpenText, Code2, Landmark, Rocket, ShieldCheck, type LucideIcon } from "lucide-react";

// Same geometry as components/brand/Logo.tsx (Seam mark), drawn large with its own load motion.
const NO_PATH = "M0 0H64V32H44V22H18V36H0Z";
const YES_PATH = "M0 64H64V36H40V26H22V40H0Z";
const SEAM = "M0 36H18V22H44V32H64";

/** The docs landing header: what MEZONK is in two lines, two ways in, and the Seam mark assembling itself. */
export function DocsHome({ description }: { title: string; description?: string }) {
  return (
    <header className="docs-hero not-prose">
      <div className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <h1>
            <span className="line">Predict with MUSD.</span>
            <span className="line text-[var(--accent-text)]">Keep your bitcoin.</span>
          </h1>
          <p className="mt-5 max-w-[60ch] text-[1.0625rem] leading-relaxed text-[var(--ink-2)]">{description}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link
              href="/docs/get-started/quick-start"
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-[var(--primary)] px-5 text-[0.9375rem] font-semibold text-[var(--on-primary)] transition-[background-color,transform] duration-150 hover:bg-[var(--primary-hover)] active:translate-y-px"
            >
              Start in 5 minutes
              <ArrowRight className="size-4" aria-hidden />
            </Link>
            <Link
              href="/docs/developers/architecture"
              className="inline-flex h-11 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-5 text-[0.9375rem] font-semibold text-[var(--ink)] transition-[border-color,transform] duration-150 hover:border-[var(--border-strong)] active:translate-y-px"
            >
              <Code2 className="size-4" aria-hidden />
              How it&apos;s built
            </Link>
          </div>
        </div>
        <svg viewBox="-8 -8 80 80" className="docs-hero-mark hidden size-44 md:block lg:size-52" aria-hidden>
          <path className="half-no" d={NO_PATH} fill="var(--logo-no)" />
          <path className="half-yes" d={YES_PATH} fill="var(--logo-yes)" />
          <path className="gap" d={SEAM} fill="none" stroke="var(--bg)" strokeWidth={1.2} strokeLinejoin="round" />
        </svg>
      </div>
    </header>
  );
}

const ROUTES: Array<{ href: string; title: string; body: string; icon: LucideIcon; wide?: boolean; points?: string[] }> = [
  {
    href: "/docs/get-started/quick-start",
    title: "Make your first trade",
    body: "From an empty wallet to holding Yes or No shares on Mezo testnet. Test money only, so you can learn it without risk.",
    icon: Rocket,
    wide: true,
    points: ["Add Mezo testnet and get test BTC", "Borrow MUSD against it, or bring your own", "Pick a market and back a side", "Sell early, or claim when it settles"],
  },
  { href: "/docs/how-it-works/shares-and-payouts", title: "How it works", body: "Shares, the order book, seeding, and how a result becomes final.", icon: BookOpenText },
  { href: "/docs/mezo/overview", title: "Built on Mezo", body: "MUSD settlement, in-app borrowing, and Mezo's price feed.", icon: Landmark },
  { href: "/docs/markets/suggest-a-market", title: "Markets", body: "Suggest a question, write rules that resolve cleanly, and who approves what.", icon: Blocks },
  { href: "/docs/developers/architecture", title: "Developers", body: "Architecture, contracts, the public API and the indexer.", icon: Code2 },
  { href: "/docs/security/trust-model", title: "Security", body: "What anyone can and can't do with your money, and the risks.", icon: ShieldCheck },
];

/** The "where to go" grid on the docs home: one large start card, the rest smaller. */
export function DocsRoutes() {
  return (
    <nav aria-label="Docs sections" className="docs-routes not-prose my-8">
      {ROUTES.map((r, i) => (
        <Link key={r.href} href={r.href} className={r.wide ? "docs-route is-wide" : "docs-route"} style={{ ["--i" as string]: i }}>
          <r.icon className="mb-1 size-5 text-[var(--accent-text)]" aria-hidden />
          <h3 className={r.wide ? "!text-xl" : undefined}>{r.title}</h3>
          <p>{r.body}</p>
          {r.points && (
            <ol className="mt-3 grid gap-2 text-[0.9375rem] sm:grid-cols-2">
              {r.points.map((p, n) => (
                <li key={p} className="flex items-start gap-2.5">
                  <span className="demo-num mt-0.5 inline-flex size-5 flex-none items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-[var(--accent-text)]">
                    {n + 1}
                  </span>
                  <span>{p}</span>
                </li>
              ))}
            </ol>
          )}
          <span className="go mt-4">
            {r.wide ? "Start the quick start" : "Read"}
            <ArrowRight className="size-3.5" aria-hidden />
          </span>
        </Link>
      ))}
    </nav>
  );
}
