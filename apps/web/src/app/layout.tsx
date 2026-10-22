import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { RefCapture } from "@/features/portfolio/Incentives";
import { Header, MobileNav } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { DeploymentBanner } from "@/components/layout/DeploymentBanner";

// One sans for everything (Geist) and a mono for numbers only (Geist Mono). The wordmark is an SVG.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "MEZONK · Prediction markets settled in MUSD", template: "%s · MEZONK" },
  description:
    "Trade Yes or No on questions with public rules. Built on Mezo, settled in MUSD.",
  icons: { icon: "/mezonk-icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F9FC" },
    { media: "(prefers-color-scheme: dark)", color: "#080A0E" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh">
        <Providers>
          <RefCapture />
          <Header />
          <DeploymentBanner />
          <main id="main" className="mx-auto w-full max-w-[84rem] px-4 pt-6 md:px-6 md:pt-8">
            {children}
          </main>
          <Footer />
          <MobileNav />
        </Providers>
      </body>
    </html>
  );
}
