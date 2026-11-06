import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

// One sans for everything (Geist) and a mono for numbers only (Geist Mono). The wordmark is an SVG.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: { default: "MEZONK · Predict without selling your bitcoin", template: "%s · MEZONK" },
  description:
    "The first prediction market on Mezo. Borrow MUSD against your bitcoin, call it right, and keep your BTC.",
  icons: { icon: "/mezonk-icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8F9FC" },
    { media: "(prefers-color-scheme: dark)", color: "#080A0E" },
  ],
};

// The app chrome lives in (site)/layout.tsx; the docs bring their own (docs/layout.tsx).
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-dvh">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
