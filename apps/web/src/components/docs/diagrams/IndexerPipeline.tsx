"use client";

import { Box, Figure, Flow, FlowLabel, Group, Note } from "./primitives";

/*
 * The indexer. Sources: apps/web/src/server/indexer/indexer.ts (tick: reorg check on the stored block hash and a
 * 64-block rewind; getLogs over the exchange + its three children in LOG_RANGE_LIMIT = 9,999-block chunks up to
 * head − INDEXER_CONFIRMATIONS (default 2); insert into chain_events on conflict (chain, tx, log index) do nothing;
 * rebuildMarket per touched market in one transaction; rebuildGlobal for deployment-wide events; reconcile every
 * 5 minutes, 25 markets, against getMarket + bestPrices, recorded for /api/indexer/status), replay.ts (replayMarket).
 */
export function IndexerPipeline() {
  return (
    <Figure
      title="Indexer pipeline: getLogs into chain_events, pure replay per market into read tables, served by the public API, with reorg rewind and reconciliation"
      width={920}
      height={676}
      minWidth={740}
      legend={["mezonk", "offchain", "danger"]}
      caption={
        <>
          Events are copied once, then every table is rebuilt from them, so the same events always give the same tables.
          A reorg throws away the last 64 blocks of events and replays; reconciliation only reports differences from the
          chain, it never overwrites them.
        </>
      }
    >
      {/* chain */}
      <Group x={200} y={20} w={520} h={96} label="Mezo chain" tone="neutral" />
      <Box x={218} y={50} w={114} h={46} label="Exchange" tone="mezonk" />
      <Box x={344} y={50} w={114} h={46} label="Factory" tone="mezonk" />
      <Box x={470} y={50} w={114} h={46} label="Resolution" tone="mezonk" />
      <Box x={596} y={50} w={114} h={46} label="Incentives" tone="mezonk" />

      {/* main pipeline */}
      <Box x={300} y={164} w={320} h={52} label="getLogs" sub="all four contracts, ≤ 9,999 blocks a call" tone="offchain" />
      <Box x={300} y={266} w={320} h={52} label="chain_events" sub="unique on (chain, tx, log index)" tone="offchain" />
      <Box x={300} y={368} w={320} h={52} label="Replay each touched market" sub="pure: events in block and log order" tone="offchain" />
      <Box
        x={300}
        y={470}
        w={320}
        h={84}
        label={<tspan dy={-6}>Read tables</tspan>}
        sub={
          <>
            <tspan dy={-8}>markets · fills · trades · positions</tspan>
            <tspan x={460} dy={16}>orders · proposals · disputes · policies</tspan>
          </>
        }
        tone="offchain"
      />
      <Box x={300} y={604} w={320} h={52} label="Public JSON API" sub="/api/markets, …/book, …/fills" tone="offchain" />

      <Flow d="M460 116 V164" tone="mezonk" label="logs up to head − 2 blocks" at={[468, 145]} anchor="start" />
      <Flow d="M460 216 V266" tone="offchain" label="insert, skip duplicates" at={[468, 246]} anchor="start" />
      <Flow d="M460 318 V368" tone="offchain" label="grouped by market" at={[468, 348]} anchor="start" />
      <Flow d="M460 420 V470" tone="offchain" label="rebuilt in one transaction" at={[468, 450]} anchor="start" />
      <Flow d="M460 554 V604" tone="offchain" label="read only" at={[468, 584]} anchor="start" />

      {/* reorg path */}
      <Box x={24} y={164} w={220} h={52} label="Reorg check" sub="last block hash still the same?" tone="danger" />
      <Flow d="M200 72 H134 V164" tone="danger" animated={false} />
      <FlowLabel x={126} y={124} anchor="end">getBlock</FlowLabel>
      <Flow d="M134 216 V292 H300" tone="danger" />
      <FlowLabel x={126} y={252} anchor="end">if not: delete</FlowLabel>
      <FlowLabel x={126} y={268} anchor="end">the last 64</FlowLabel>
      <FlowLabel x={126} y={284} anchor="end">blocks, re-fetch</FlowLabel>

      {/* reconcile path */}
      <Box x={700} y={470} w={200} h={52} label="Reconcile" sub="every 5 min, 25 markets" tone="neutral" />
      <Flow d="M720 72 H800 V470" tone="mezonk" animated={false} />
      <FlowLabel x={792} y={448} anchor="end">getMarket, bestPrices</FlowLabel>
      <Flow d="M620 496 H700" tone="offchain" animated={false} label="compare" at={[660, 489]} />
      <Box x={700} y={604} w={200} h={52} label="Indexer status" sub="/api/indexer/status" tone="offchain" />
      <Flow d="M800 522 V604" tone="neutral" label="mismatches" at={[808, 568]} anchor="start" />

      {/* notes */}
      <Note x={636} y={186} size={12.5}>Cursor and block hash</Note>
      <Note x={636} y={204} size={12.5}>saved after each chunk</Note>
      <Note x={636} y={390} size={12.5}>Plus one rebuild of the</Note>
      <Note x={636} y={408} size={12.5}>deployment-wide tables</Note>
      <Note x={24} y={622} size={12.5}>A read model: no route moves</Note>
      <Note x={24} y={640} size={12.5}>money because of it.</Note>
    </Figure>
  );
}
