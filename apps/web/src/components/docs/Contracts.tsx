"use client";

import { Address } from "@/components/ui/Address";
import { deployment, readinessMessage } from "@/lib/chain/config";

/** The contract addresses this app is configured with, so readers can check them on the explorer. Never hardcoded. */
export function Contracts() {
  if (!deployment.ready) return <p className="not-prose text-sm text-[var(--warn)]">{readinessMessage[deployment.reason]}</p>;
  const rows: Array<[string, string | null, string]> = [
    ["MezonkExchange", deployment.marketsAddress, "Shares, orders, collateral, graduation"],
    ["MezonkMarketFactory", deployment.factoryAddress, "Roles, curator approvals, opening markets"],
    ["MezonkResolution", deployment.resolutionAddress, "Proposals, challenges, rulings, bonds"],
    ["MezonkIncentives", deployment.incentivesAddress, "Seeder rebates and referral credit"],
    ["MezonkPriceResolver", deployment.priceResolverAddress, "Settles BTC price markets from Mezo's PriceFeed"],
    ["MUSD (collateral)", deployment.musd, "Mezo's bitcoin-backed dollar"],
  ];
  return (
    <div className="not-prose my-6 overflow-x-auto rounded-[14px] border border-[var(--border)] bg-[var(--surface)]">
      <table className="w-full min-w-[34rem] text-left text-[0.9375rem]">
        <caption className="px-4 pt-3 text-left text-xs text-[var(--muted)]">
          {deployment.isLocalFork ? `Local fork of ${deployment.chain.name}` : deployment.chain.name} · chain {deployment.chainId}
        </caption>
        <thead>
          <tr className="text-[var(--ink)]">
            <th scope="col" className="px-4 py-2.5 font-semibold">Contract</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Address</th>
            <th scope="col" className="px-4 py-2.5 font-semibold">Holds or does</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)] text-[var(--ink-2)]">
          {rows.map(([name, addr, what]) => (
            <tr key={name} className="align-top">
              <th scope="row" className="px-4 py-3 font-medium text-[var(--ink)]">{name}</th>
              <td className="px-4 py-3">{addr ? <Address address={addr} label={name} /> : <span className="text-[var(--muted)]">Not deployed yet</span>}</td>
              <td className="px-4 py-3">{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
