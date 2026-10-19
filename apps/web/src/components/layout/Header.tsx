"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";
import { Activity, BookOpen, Compass, LayoutList, PlusSquare, Wallet } from "lucide-react";
import { Lockup, LogoMark } from "@/components/brand/Logo";
import { cx } from "@/components/ui/cx";
import { NetworkStatus } from "./NetworkStatus";
import { SearchBox } from "./SearchBox";
import { ThemeToggle } from "./ThemeToggle";
import { WalletButton } from "@/components/wallet/WalletButton";

export const NAV = [
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/markets", label: "Markets", icon: LayoutList },
  { href: "/create", label: "Create", icon: PlusSquare },
  { href: "/portfolio", label: "Portfolio", icon: Wallet },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/docs", label: "Docs", icon: BookOpen },
] as const;

const isActive = (path: string, href: string) => path === href || path.startsWith(`${href}/`);

export function Header() {
  const path = usePathname();
  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b border-line bg-bg/92 backdrop-blur-sm">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 md:px-6">
        <Link href="/" aria-label="MEZONK home" className="shrink-0">
          <Lockup className="hidden sm:inline-flex" />
          <LogoMark size={26} className="sm:hidden" />
        </Link>
        <nav aria-label="Primary" className="hidden items-center gap-0.5 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(path, n.href) ? "page" : undefined}
              className={cx(
                "rounded-md px-2.5 py-1.5 text-sm font-semibold transition-colors",
                isActive(path, n.href) ? "text-ink bg-surface-2" : "text-ink-2 hover:text-ink",
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden flex-1 justify-end md:flex">
          <Suspense>
            <SearchBox />
          </Suspense>
        </div>
        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <span className="hidden xl:inline">
            <NetworkStatus />
          </span>
          <span className="xl:hidden">
            <NetworkStatus compact />
          </span>
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

/** Bottom navigation on small screens. Docs lives in the footer there. */
export function MobileNav() {
  const path = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-line bg-bg/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {NAV.slice(0, 5).map((n) => {
          const active = isActive(path, n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cx("flex flex-col items-center gap-0.5 py-2 text-[11px] font-semibold", active ? "text-ink" : "text-muted")}
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
