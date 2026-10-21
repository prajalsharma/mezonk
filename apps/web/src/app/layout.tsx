import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Hanken_Grotesk, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { RefCapture } from "@/features/portfolio/Incentives";
import { Header, MobileNav } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { DeploymentBanner } from "@/components/layout/DeploymentBanner";

// UI: Geist. Numbers: Geist Mono. Hero moments: Instrument Serif. Wordmark only: Hanken Grotesk (brand sheet).
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const serif = Instrument_Serif({ subsets: ["latin"], variable: "--font-serif", weight: "400", style: ["normal", "italic"] });
const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", weight: ["600"] });

export const metadata: Metadata = {
  title: { default: "MEZONK · Prediction markets settled in MUSD", template: "%s · MEZONK" },
  description:
    "Turn your conviction into a market. Trade YES or NO with MUSD on Mezo, with rules committed on-chain and a public dispute trail.",
  icons: { icon: "/mezonk-icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F3F5F8" },
    { media: "(prefers-color-scheme: dark)", color: "#090C13" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable} ${serif.variable} ${hanken.variable}`}>
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
