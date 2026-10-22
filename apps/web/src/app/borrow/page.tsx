import type { Metadata } from "next";
import { BorrowPanel } from "@/features/borrow/BorrowPanel";

export const metadata: Metadata = {
  title: "Borrow MUSD",
  description: "Lock BTC on Mezo and borrow MUSD to trade with, without selling your bitcoin.",
};

export default function BorrowPage() {
  return (
    <div className="space-y-10">
      <header className="max-w-2xl space-y-3">
        <h1 className="display text-4xl md:text-5xl">Borrow MUSD. Keep your BTC.</h1>
        <p className="text-lg text-ink-2">
          Lock BTC on Mezo and get MUSD to trade with. It&apos;s a loan from Mezo&apos;s own contracts, signed from your wallet.
          MEZONK never holds your bitcoin.
        </p>
      </header>
      <BorrowPanel />
    </div>
  );
}
