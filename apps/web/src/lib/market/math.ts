/**
 * TypeScript mirror of contracts/src/libraries/FPMMMath.sol. Used for instant quotes in the UI;
 * every quote is re-checked against the contract's quoteBuy/quoteSell before a transaction is sent.
 * All values are bigint in 18-decimal units. Rounding matches the contract.
 */

const BPS = 10_000n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

function sqrtCeil(x: bigint): bigint {
  if (x < 0n) throw new Error("negative");
  if (x < 2n) return x;
  let z = x;
  let y = (x >> 1n) + 1n;
  while (y < z) {
    z = y;
    y = (x / y + y) >> 1n;
  }
  return z * z === x ? z : z + 1n;
}

export interface Pool {
  yes: bigint;
  no: bigint;
}

export const priceYes = (p: Pool) => (p.yes + p.no === 0n ? 0 : Number((p.no * 1_000_000n) / (p.yes + p.no)) / 1e6);

export function buyShares(poolOut: bigint, poolOther: bigint, netIn: bigint) {
  if (netIn <= 0n) throw new Error("zero amount");
  const newPoolOther = poolOther + netIn;
  const newPoolOut = ceilDiv(poolOut * poolOther, newPoolOther);
  return { sharesOut: poolOut + netIn - newPoolOut, newPoolOut, newPoolOther };
}

export function sellShares(poolIn: bigint, poolOther: bigint, sharesIn: bigint) {
  if (sharesIn <= 0n) throw new Error("zero amount");
  const b = poolIn + sharesIn + poolOther;
  const disc = b * b - 4n * sharesIn * poolOther;
  let gross = (b - sqrtCeil(disc)) / 2n;
  const k = poolIn * poolOther;
  while (gross > 0n && (poolIn + sharesIn - gross) * (poolOther - gross) < k) gross -= 1n;
  if (gross === 0n || gross >= poolOther) throw new Error("insufficient pool");
  return { grossOut: gross, newPoolIn: poolIn + sharesIn - gross, newPoolOther: poolOther - gross };
}

export interface BuyQuote {
  side: "yes" | "no";
  amountIn: bigint;
  fee: bigint;
  shares: bigint;
  /** Average price paid per share, 0..1. */
  avgPrice: number;
  priceBefore: number;
  /** YES price after the trade. */
  priceAfterYes: number;
  /** Relative difference between average execution price and pre-trade price of the side. */
  priceImpact: number;
  /** Collateral returned if the chosen side wins: 1 MUSD per share. */
  payoutIfWin: bigint;
  profitIfWin: bigint;
}

export function quoteBuy(pool: Pool, side: "yes" | "no", amountIn: bigint, feeBps: number): BuyQuote {
  const fee = (amountIn * BigInt(feeBps)) / BPS;
  const net = amountIn - fee;
  const before = side === "yes" ? priceYes(pool) : 1 - priceYes(pool);
  const r = side === "yes" ? buyShares(pool.yes, pool.no, net) : buyShares(pool.no, pool.yes, net);
  const after: Pool = side === "yes" ? { yes: r.newPoolOut, no: r.newPoolOther } : { yes: r.newPoolOther, no: r.newPoolOut };
  const avgPrice = Number(amountIn) / Number(r.sharesOut);
  return {
    side,
    amountIn,
    fee,
    shares: r.sharesOut,
    avgPrice,
    priceBefore: before,
    priceAfterYes: priceYes(after),
    priceImpact: before === 0 ? 0 : avgPrice / before - 1,
    payoutIfWin: r.sharesOut,
    profitIfWin: r.sharesOut - amountIn,
  };
}

export interface SellQuote {
  side: "yes" | "no";
  sharesIn: bigint;
  gross: bigint;
  fee: bigint;
  out: bigint;
  avgPrice: number;
  priceAfterYes: number;
}

export function quoteSell(pool: Pool, side: "yes" | "no", sharesIn: bigint, feeBps: number): SellQuote {
  const r = side === "yes" ? sellShares(pool.yes, pool.no, sharesIn) : sellShares(pool.no, pool.yes, sharesIn);
  const fee = (r.grossOut * BigInt(feeBps)) / BPS;
  const after: Pool = side === "yes" ? { yes: r.newPoolIn, no: r.newPoolOther } : { yes: r.newPoolOther, no: r.newPoolIn };
  return {
    side,
    sharesIn,
    gross: r.grossOut,
    fee,
    out: r.grossOut - fee,
    avgPrice: Number(r.grossOut - fee) / Number(sharesIn),
    priceAfterYes: priceYes(after),
  };
}

/** Minimum acceptable output after slippage tolerance (bps). */
export const withSlippage = (amount: bigint, slippageBps: number) => (amount * (BPS - BigInt(slippageBps))) / BPS;
