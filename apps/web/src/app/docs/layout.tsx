import type { ReactNode } from "react";
import Link from "next/link";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider";
import { ArrowUpRight, Landmark, LayoutList, Wallet } from "lucide-react";
import { Lockup } from "@/components/brand/Logo";
import { source } from "@/lib/docs/source";
import { deployment } from "@/lib/chain/config";
import { Spotlight } from "@/components/docs/Spotlight";
import "./docs.css";

// The docs bring their own chrome (Fumadocs layout); the app header and footer live in (site)/layout.tsx.
// The app's ThemeProvider already sets data-theme and the .dark class, so Fumadocs' own theme provider is off.
export default function Layout({ children }: { children: ReactNode }) {
  return (
    <RootProvider theme={{ enabled: false }} search={{ options: { api: "/api/docs-search" } }}>
      <div className="docs-root">
        <Spotlight />
        <DocsLayout
          tree={source.pageTree}
          nav={{
            title: (
              <span className="flex items-center gap-2.5">
                <Lockup />
                <span aria-hidden className="h-5 w-px bg-fd-border" />
                <span className="text-[0.9375rem] font-medium text-fd-muted-foreground">Docs</span>
              </span>
            ),
            url: "/docs",
            transparentMode: "top",
          }}
          githubUrl="https://github.com/prajalsharma/mezonk"
          links={[
            { text: "Markets", url: "/markets", icon: <LayoutList />, active: "none" },
            { text: "Borrow MUSD", url: "/borrow", icon: <Landmark />, active: "none" },
            { text: "Portfolio", url: "/portfolio", icon: <Wallet />, active: "none" },
          ]}
          sidebar={{
            defaultOpenLevel: 1,
            banner: <NetworkCard />,
            footer: (
              <Link href="/markets" className="docs-open-app">
                Open the app
                <ArrowUpRight className="size-4" aria-hidden />
              </Link>
            ),
          }}
        >
          {children}
        </DocsLayout>
      </div>
    </RootProvider>
  );
}

/** Which network the app points at, so readers know the docs' live numbers come from there. */
function NetworkCard() {
  const live = deployment.ready && !deployment.isLocalFork;
  return (
    <div className="docs-network">
      <span aria-hidden className={live ? "docs-network-dot is-live" : "docs-network-dot"} />
      <span className="min-w-0">
        <span className="block text-[0.8125rem] font-medium text-fd-foreground">{deployment.chain.name}</span>
        <span className="block text-xs text-fd-muted-foreground">{live ? "Contracts live · test money only" : "Contracts not configured"}</span>
      </span>
    </div>
  );
}
