"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, LayoutList, Lightbulb, Search, Wallet } from "lucide-react";
import { Lockup, LogoMark } from "@/components/brand/Logo";
import { cx } from "@/components/ui/cx";
import { useAccount } from "wagmi";
import { useOnchainRoles } from "@/hooks/useOnchainRoles";
import { AccountMenu } from "./AccountMenu";
import { CommandPalette } from "./CommandPalette";
import { NetworkStatus } from "./NetworkStatus";
import { ThemeToggle } from "./ThemeToggle";
import { WalletButton } from "@/components/wallet/WalletButton";

// Three primary destinations plus docs. Discover, Activity, Resolution and Status live in the footer.
export const NAV = [
  { href: "/markets", label: "Markets", icon: LayoutList },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/suggest", label: "Suggest", icon: Lightbulb },
  { href: "/docs", label: "Docs", icon: BookOpen },
] as const;

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export function Header() {
  const path = usePathname();
  const [palette, setPalette] = useState(false);
  // Role links appear as soon as a wallet connects (chain read), no sign-in needed.
  const { address } = useAccount();
  const roles = useOnchainRoles(address);
  const showCurate = roles.curator || roles.owner;
  const showResolve = roles.resolver || roles.arbitrator;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      }
      const t = e.target as HTMLElement;
      if (e.key === "/" && !/input|textarea|select/i.test(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] px-3 pt-3 md:px-4">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="glass mx-auto flex h-14 max-w-[84rem] items-center gap-3 rounded-xl border px-3 shadow-2 md:px-4">
        <Link href="/" aria-label="MEZONK home" className="press shrink-0 rounded-md px-1 py-1">
          <Lockup className="hidden sm:inline-flex" />
          <LogoMark size={28} className="sm:hidden" title="MEZONK" />
        </Link>
        <span aria-hidden className="mx-1 hidden h-6 w-px bg-line lg:block" />
        <nav aria-label="Primary" className="hidden items-center gap-0.5 lg:flex">
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href} active={isActive(path, n.href)}>{n.label}</NavLink>
          ))}
          {showCurate && <NavLink href="/curate" active={isActive(path, "/curate")}>Curate</NavLink>}
          {showResolve && <NavLink href="/resolve" active={isActive(path, "/resolve")}>Resolve</NavLink>}
        </nav>
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={() => setPalette(true)}
            aria-label="Search markets (⌘K)"
            className="press inline-flex h-9 items-center gap-2 rounded-md border border-line bg-sunk/70 px-2.5 text-sm text-muted transition-colors hover:border-ink-2/40 hover:text-ink md:w-60 md:justify-start"
          >
            <Search className="size-4" aria-hidden />
            <span className="hidden md:inline">Search markets</span>
            <kbd className="mono ml-auto hidden rounded-sm border border-line bg-surface px-1.5 text-[11px] md:block">⌘K</kbd>
          </button>
          <span className="hidden xl:inline"><NetworkStatus /></span>
          <span className="hidden min-[380px]:inline xl:hidden"><NetworkStatus compact /></span>
          <ThemeToggle />
          <AccountMenu />
          <WalletButton />
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
    </header>
  );
}

function NavLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "relative rounded-sm px-3 py-1.5 text-sm font-medium transition-colors duration-150",
        active ? "bg-surface-2 text-ink ring-1 ring-line" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

/** Bottom navigation on small screens. */
export function MobileNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] lg:hidden"
    >
      <ul className="glass mx-auto grid max-w-md grid-cols-4 rounded-xl border shadow-3">
        {NAV.map((n) => {
          const active = isActive(path, n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx("press flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium", active ? "text-ink" : "text-muted")}
              >
                <n.icon className="size-5" aria-hidden />
                {n.label}
                <span aria-hidden className={cx("mt-0.5 size-1 rounded-full", active ? "bg-accent" : "bg-transparent")} />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
