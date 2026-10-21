"use client";

import { erc20Abi, getAddress, type Address, type Hash, type Hex } from "viem";
import { deployment } from "@/lib/chain/config";
import { exchangeAbi } from "@/lib/contracts/abi";
import { exchangeDomain, ORDER_TYPES, type SignedOrder } from "@/lib/orderbook/math";
import type { QuoteDto, SignedOrderRow } from "./api";

const ZERO = "0x0000000000000000000000000000000000000000" as const;

type Write = (args: {
  address: Address;
  abi: unknown;
  functionName: string;
  args: readonly unknown[];
  chainId: number;
}) => Promise<Hash>;

const ex = () => {
  if (!deployment.marketsAddress) throw new Error("No exchange is configured on this network.");
  return deployment.marketsAddress;
};

export const approveMusd = (write: Write, amount: bigint) =>
  write({ address: deployment.musd, abi: erc20Abi, functionName: "approve", args: [ex(), amount], chainId: deployment.chainId });

/** Contract call for a quote's sources, exactly as the server returned them. */
/** `nowS` must be chain time (latest block timestamp): the contract compares the deadline with block.timestamp. */
export function takeArgs(q: QuoteDto, t: { marketId: number; outcome: number; side: number; limit: number; quantity: bigint; minFill: bigint; nowS: bigint }) {
  const sources = q.sources.map((s) => ({
    restingId: BigInt(s.restingId),
    order: {
      maker: getAddress(s.order.maker),
      taker: getAddress(s.order.taker),
      marketId: BigInt(s.order.marketId),
      outcome: s.order.outcome,
      side: s.order.side,
      price: s.order.price,
      quantity: BigInt(s.order.quantity),
      expiry: BigInt(s.order.expiry),
      nonce: BigInt(s.order.nonce),
      salt: BigInt(s.order.salt),
    },
    signature: s.signature as Hex,
  }));
  return [
    {
      marketId: BigInt(t.marketId),
      outcome: t.outcome,
      side: t.side,
      limitPrice: t.limit,
      quantity: t.quantity,
      minFill: t.minFill,
      deadline: t.nowS + 300n,
    },
    sources,
  ] as const;
}

export const take = (write: Write, args: ReturnType<typeof takeArgs>) =>
  write({ address: ex(), abi: exchangeAbi, functionName: "take", args, chainId: deployment.chainId });

export const placeEscrowed = (write: Write, marketId: number, outcome: number, side: number, price: number, quantity: bigint) =>
  write({ address: ex(), abi: exchangeAbi, functionName: "placeOrder", args: [BigInt(marketId), outcome, side, price, quantity], chainId: deployment.chainId });

export const cancelEscrowed = (write: Write, orderId: number) =>
  write({ address: ex(), abi: exchangeAbi, functionName: "cancelOrder", args: [BigInt(orderId)], chainId: deployment.chainId });

export const graduate = (write: Write, marketId: number) =>
  write({ address: ex(), abi: exchangeAbi, functionName: "graduate", args: [BigInt(marketId)], chainId: deployment.chainId });

export const splitSets = (write: Write, marketId: number, amount: bigint) =>
  write({ address: ex(), abi: exchangeAbi, functionName: "split", args: [BigInt(marketId), amount], chainId: deployment.chainId });

export const mergeSets = (write: Write, marketId: number, amount: bigint) =>
  write({ address: ex(), abi: exchangeAbi, functionName: "merge", args: [BigInt(marketId), amount], chainId: deployment.chainId });

export const redeem = (write: Write, marketId: number) =>
  write({ address: ex(), abi: exchangeAbi, functionName: "redeem", args: [BigInt(marketId)], chainId: deployment.chainId });

/** On-chain cancellation of signed orders: the only way to make a signature permanently unusable. */
export const cancelSigned = (write: Write, rows: SignedOrderRow[]) =>
  write({
    address: ex(),
    abi: exchangeAbi,
    functionName: "cancelSignedOrders",
    args: [
      rows.map((o) => ({
        maker: getAddress(o.maker),
        taker: getAddress(o.taker),
        marketId: BigInt(o.marketId),
        outcome: o.outcome,
        side: o.side,
        price: o.price,
        quantity: BigInt(o.quantity),
        expiry: BigInt(Math.floor(new Date(o.expiry).getTime() / 1000)),
        nonce: BigInt(o.nonce),
        salt: BigInt(o.salt),
      })),
    ],
    chainId: deployment.chainId,
  });

export function randomSalt(): bigint {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return BigInt(`0x${[...b].map((x) => x.toString(16).padStart(2, "0")).join("")}`);
}

/** Build, sign (EIP-712) and submit a resting limit order. Resolves when the book accepted it, not when it trades. */
export async function signAndPost(
  sign: (args: { domain: ReturnType<typeof exchangeDomain>; types: typeof ORDER_TYPES; primaryType: "Order"; message: SignedOrder }) => Promise<Hex>,
  o: { maker: Address; marketId: number; outcome: number; side: number; price: number; quantity: bigint; expirySeconds: number; nonce: bigint; nowS: bigint },
) {
  const message: SignedOrder = {
    maker: o.maker,
    taker: ZERO,
    marketId: BigInt(o.marketId),
    outcome: o.outcome,
    side: o.side,
    price: o.price,
    quantity: o.quantity,
    expiry: o.nowS + BigInt(o.expirySeconds), // chain time, as the contract checks it
    nonce: o.nonce,
    salt: randomSalt(),
  };
  const signature = await sign({ domain: exchangeDomain(deployment.chainId, ex()), types: ORDER_TYPES, primaryType: "Order", message });
  const r = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      maker: message.maker,
      taker: message.taker,
      marketId: String(message.marketId),
      outcome: message.outcome,
      side: message.side,
      price: message.price,
      quantity: String(message.quantity),
      expiry: String(message.expiry),
      nonce: String(message.nonce),
      salt: String(message.salt),
      signature,
    }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error?.message ?? "The order book didn't accept this order.");
  return body as { hash: string; status: "open" };
}
