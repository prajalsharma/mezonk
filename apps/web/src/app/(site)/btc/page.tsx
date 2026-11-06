import type { Metadata } from "next";
import { BtcRounds } from "@/features/btc/BtcRounds";

export const metadata: Metadata = {
  title: "BTC up or down",
  description: "Stake BTC on whether bitcoin's price is higher or lower at the end of each round. Settled from Mezo's own price feed, paid in BTC.",
};

export default function BtcPage() {
  return (
    <div className="space-y-8">
      <header className="max-w-2xl space-y-3">
        <h1 className="display text-4xl md:text-5xl">BTC up or down, with BTC.</h1>
        <p className="text-lg text-ink-2">
          Call the direction, stake bitcoin, and get paid in bitcoin. Prices come from the same Mezo feed that prices loans, and
          the only money in the contract is the players&apos; stakes.
        </p>
      </header>
      <BtcRounds />
    </div>
  );
}
