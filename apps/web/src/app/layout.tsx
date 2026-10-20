import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { Header, MobileNav } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { DeploymentBanner } from "@/components/layout/DeploymentBanner";

const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", weight: ["400", "500", "600", "700"] });

export const metadata: Metadata = {
  title: { default: "MEZONK · Prediction markets settled in MUSD", template: "%s · MEZONK" },
  description:
    "Turn your conviction into a market. Trade YES or NO with MUSD on Mezo, with rules committed on-chain and a public dispute trail.",
  icons: { icon: "/mezonk-icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F2EFE9" },
    { media: "(prefers-color-scheme: dark)", color: "#14110F" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={hanken.variable}>
      <body className="min-h-dvh">
        <Providers>
          <Header />
          <DeploymentBanner />
          <main id="main" className="mx-auto w-full max-w-7xl px-4 pt-6 md:px-6 md:pt-10">
            {children}
          </main>
          <Footer />
          <MobileNav />
        </Providers>
      </body>
    </html>
  );
}
