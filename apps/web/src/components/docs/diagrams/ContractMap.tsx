"use client";

import { Box, Figure, Flow, Note, StepDot } from "./primitives";

/*
 * The four contracts. Sources: contracts/src/MezonkExchange.sol (constructor creates resolution, factory,
 * incentives in that order; openMarket only from factory; settle only from resolution; _accrueFee sends the
 * incentive part to incentives; creditSweptRebates only from incentives; owner: policies, pause, withdrawProtocolFees),
 * MezonkMarketFactory.sol (createMarket by an approved creator with a curator's EIP-712 approval; owner sets
 * creator/curator/resolver lists and config), MezonkResolution.sol (propose, dispute, arbitrate, finalize; holds bonds),
 * MezonkIncentives.sol (rebate and referral reserves, claims, permissionless sweep back to the exchange).
 * Nonces 1, 2, 3: apps/web/src/lib/chain/config.ts protocolAddresses().
 */
export function ContractMap() {
  return (
    <Figure
      title="MEZONK contract map: what each contract holds, who calls it, and how the four contracts call each other"
      width={940}
      height={612}
      minWidth={760}
      legend={["mezonk", "user"]}
      caption={
        <>
          The exchange is the only contract that holds traders&apos; money. The factory holds nothing: it only checks
          who may publish. A market outcome can only reach the exchange through the resolution contract&apos;s{" "}
          <code>settle</code> call, and only the factory can open a market.
        </>
      }
    >
      {/* deployment note */}
      <StepDot x={672} y={40} n={1} />
      <StepDot x={698} y={40} n={2} />
      <StepDot x={724} y={40} n={3} />
      <Note x={744} y={44} size={12.5}>= exchange nonce</Note>
      <Note x={662} y={70} size={12.5}>The exchange constructor deploys the</Note>
      <Note x={662} y={88} size={12.5}>other three. Every address is fixed.</Note>

      {/* roles, top */}
      <Box x={24} y={28} w={190} h={52} label="Owner" sub="exchange + factory" tone="user" />
      <Box x={460} y={28} w={180} h={52} label="Traders" sub="any wallet" tone="user" />

      {/* contracts */}
      <Box x={24} y={200} w={190} h={90} label="MezonkMarketFactory" sub="holds: nothing" tone="mezonk" />
      <Box
        x={300}
        y={200}
        w={300}
        h={90}
        label="MezonkExchange"
        sub="holds: collateral, order escrow, fees"
        tone="mezonk"
        emphasis
      />
      <Box x={692} y={200} w={224} h={90} label="MezonkIncentives" sub="holds: rebate + referral reserves" tone="mezonk" />
      <Box x={300} y={400} w={300} h={70} label="MezonkResolution" sub="holds: proposer + dispute bonds" tone="mezonk" />
      <StepDot x={300} y={400} n={1} />
      <StepDot x={24} y={200} n={2} />
      <StepDot x={692} y={200} n={3} />

      {/* roles, sides and bottom */}
      <Box x={24} y={400} w={190} h={52} label="Creator" sub="approved on the factory" tone="user" />
      <Box x={24} y={540} w={190} h={52} label="Curator" sub="approved on the factory" tone="user" />
      <Box x={274} y={540} w={108} h={52} label="Resolver" sub="per market" tone="user" />
      <Box x={396} y={540} w={108} h={52} label="Arbitrator" sub="per market" tone="user" />
      <Box x={518} y={540} w={108} h={52} label="Anyone" sub="not the proposer" tone="user" />
      <Box x={692} y={400} w={224} h={52} label="Seeders, referrers" sub="earned from fees" tone="user" />

      {/* owner */}
      <Flow d="M119 80 V200" tone="user" animated={false} label="creator, curator, resolver lists" at={[128, 116]} anchor="start" />
      <Flow d="M214 54 H380 V200" tone="user" animated={false} label="policies, pause, fees" at={[372, 180]} anchor="end" />

      {/* traders */}
      <Flow d="M550 80 V200" tone="user" label="split · merge · take · placeOrder · redeem" at={[560, 146]} anchor="start" />

      {/* governance */}
      <Flow d="M119 540 V452" tone="user" dashed animated={false} label="signs approval (EIP-712)" at={[128, 500]} anchor="start" />
      <Flow d="M119 400 V290" tone="user" label="createMarket + signature" at={[128, 349]} anchor="start" />

      {/* contract → contract */}
      <Flow d="M214 245 H300" tone="mezonk" label="openMarket" at={[257, 238]} />
      <Flow d="M450 400 V290" tone="mezonk" label="settle(outcome)" at={[459, 349]} anchor="start" />
      <Flow d="M600 230 H692" tone="mezonk" label="fee share" at={[646, 223]} />
      <Flow d="M692 262 H600" tone="mezonk" label="swept back" at={[646, 255]} />

      {/* resolution roles */}
      <Flow d="M328 540 V470" tone="user" label="propose + bond" at={[336, 509]} anchor="start" />
      <Flow d="M450 540 V470" tone="user" label="arbitrate" at={[458, 509]} anchor="start" />
      <Flow d="M572 540 V470" tone="user" label="dispute + bond, finalize" at={[580, 509]} anchor="start" />

      {/* incentives claims */}
      <Flow d="M804 400 V290" tone="user" label="claim" at={[813, 349]} anchor="start" />
    </Figure>
  );
}
