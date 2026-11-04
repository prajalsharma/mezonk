"use client";

import { getAddress } from "viem";
import { useReadContracts } from "wagmi";
import { KeyValue } from "@/components/ui/primitives";
import { deployment, hasExplorer } from "@/lib/chain/config";
import { priceResolverAbi } from "@/lib/contracts/abi";
import { formatDateTime } from "@/lib/format";
import { MEZO_BORROW } from "@/lib/mezo/borrow";

const usd = (wei: bigint) => `$${(Number(wei / 10n ** 16n) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const outcome = (o: number) => (o === 1 ? "Yes" : o === 2 ? "No" : "—");

/** True when this market's resolver is the configured PriceFeed resolver. */
export const isPriceResolved = (resolver: string) =>
  !!deployment.priceResolverAddress && getAddress(resolver) === deployment.priceResolverAddress;

/**
 * For BTC-price markets: the rule recorded on-chain before close, and, once a keeper has settled it, the exact
 * reading from Mezo's PriceFeed (price, oracle round, update time, block). Everything is a contract read.
 */
export function PriceFeedRule({ marketId, closeTime, chainNow }: { marketId: number; closeTime: bigint; chainNow: bigint }) {
  const base = { address: deployment.priceResolverAddress!, abi: priceResolverAbi, chainId: deployment.chainId } as const;
  const q = useReadContracts({
    allowFailure: true,
    contracts: [
      { ...base, functionName: "rules", args: [BigInt(marketId)] },
      { ...base, functionName: "readings", args: [BigInt(marketId)] },
      { ...base, functionName: "captureWindow" },
    ],
    query: { enabled: !!deployment.priceResolverAddress, refetchInterval: 15_000 },
  });
  const rule = q.data?.[0]?.status === "success" ? (q.data[0].result as readonly [bigint, number, boolean]) : null;
  const reading = q.data?.[1]?.status === "success" ? (q.data[1].result as readonly [bigint, bigint, bigint, bigint, bigint, number]) : null;
  const windowS = q.data?.[2]?.status === "success" ? Number(q.data[2].result as number) : null;
  const feed = MEZO_BORROW[deployment.chainId]?.priceFeed;

  const [strike, direction, set] = rule ?? [0n, 0, false];
  const [price, roundId, updatedAt, , blockNumber, out] = reading ?? [0n, 0n, 0n, 0n, 0n, 0];

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h3 className="font-semibold">Settled by Mezo&apos;s BTC price feed</h3>
      <p className="mt-1 text-sm text-ink-2">
        {set ? (
          <>
            Resolves <span className="font-medium text-ink">Yes</span> if BTC is {direction === 0 ? "at or above" : "below"}{" "}
            <span className="mono text-ink">{usd(strike)}</span> on Mezo&apos;s PriceFeed when trading closes, otherwise No.
          </>
        ) : (
          "The price rule hasn't been recorded on-chain yet."
        )}{" "}
        It&apos;s the same price Mezo uses for loans and liquidations. A keeper reads it within {windowS ? Math.round(windowS / 60) : "a few"} minutes
        of close and proposes the result, which can still be challenged like any other.
      </p>
      <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
        {price > 0n ? (
          <>
            <KeyValue label="BTC price read">{usd(price)}</KeyValue>
            <KeyValue label="Result">{outcome(out)}</KeyValue>
            <KeyValue label="Oracle updated">{formatDateTime(new Date(Number(updatedAt) * 1000))}</KeyValue>
            <KeyValue label="Block · round">
              <span className="mono">{blockNumber.toString()} · {roundId.toString()}</span>
            </KeyValue>
          </>
        ) : (
          <KeyValue label="Reading">{chainNow < closeTime ? "After close" : "Waiting for the keeper"}</KeyValue>
        )}
        {feed && hasExplorer && (
          <KeyValue label="Source">
            <a className="underline" href={`${deployment.explorer}/address/${feed}`} target="_blank" rel="noreferrer">Mezo PriceFeed</a>
          </KeyValue>
        )}
      </dl>
    </div>
  );
}
