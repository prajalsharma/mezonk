import { parseAbi, zeroAddress, type Address, type PublicClient } from "viem";
import { MEZO_MAINNET_ID, MEZO_TESTNET_ID } from "@/lib/chain/config";

/**
 * Borrowing MUSD against BTC on Mezo (github.com/mezo-org/musd, a Liquity-v1-style CDP).
 * The user's own wallet calls BorrowerOperations, sending BTC as msg.value; MUSD is minted straight to them.
 * MEZONK never holds the BTC or the loan.
 *
 * Addresses come from mezo-org/musd `solidity/artifacts/deployments/{matsnet,mainnet}`. Verified on-chain 2026-10-22:
 * every contract has code, they reference each other, and MUSD.mintList(BorrowerOperations) is true.
 */
export interface MezoBorrowContracts {
  borrowerOperations: Address;
  troveManager: Address;
  sortedTroves: Address;
  hintHelpers: Address;
  priceFeed: Address;
  interestRateManager: Address;
}

export const MEZO_BORROW: Record<number, MezoBorrowContracts> = {
  [MEZO_TESTNET_ID]: {
    borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
    troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
    sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
    hintHelpers: "0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6",
    priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
    interestRateManager: "0xD4D6c36A592A2c5e86035A6bca1d57747a567f37",
  },
  [MEZO_MAINNET_ID]: {
    borrowerOperations: "0x44b1bac67dDA612a41a58AAf779143B181dEe031",
    troveManager: "0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193",
    sortedTroves: "0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f",
    hintHelpers: "0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3",
    priceFeed: "0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88",
    interestRateManager: "0x4a453700d157717Fe02fB62E7700ED7845048285",
  },
};

export const borrowerOperationsAbi = parseAbi([
  "function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) payable",
  "function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint)",
  "function minNetDebt() view returns (uint256)",
  "function borrowingRate() view returns (uint256)",
  "function MUSD_GAS_COMPENSATION() view returns (uint256)",
  "function MCR() view returns (uint256)",
  "function CCR() view returns (uint256)",
]);

export const troveManagerAbi = parseAbi([
  "function getTroveStatus(address) view returns (uint8)",
  "function getEntireDebtAndColl(address) view returns (uint256 coll, uint256 principal, uint256 interest, uint256 pendingCollateral, uint256 pendingPrincipal, uint256 pendingInterest)",
  "function getTroveMaxBorrowingCapacity(address) view returns (uint256)",
  "function checkRecoveryMode(uint256 _price) view returns (bool)",
]);

const sortedTrovesAbi = parseAbi([
  "function getSize() view returns (uint256)",
  "function findInsertPosition(uint256 _NICR, address _prevId, address _nextId) view returns (address, address)",
]);
const hintHelpersAbi = parseAbi([
  "function getApproxHint(uint256 _CR, uint256 _numTrials, uint256 _inputRandomSeed) view returns (address hintAddress, uint256 diff, uint256 latestRandomSeed)",
]);
const priceFeedAbi = parseAbi(["function fetchPrice() view returns (uint256)"]);
const interestRateAbi = parseAbi(["function interestRate() view returns (uint16)"]);

export const WAD = 10n ** 18n;
/** Trove status 1 = active. One active loan per address. */
export const TROVE_ACTIVE = 1;
/** Collateral ratio the form suggests, and below which it warns. Mezo itself only requires MCR (110%). */
export const SUGGESTED_RATIO = 2n * WAD;
export const WARN_RATIO = (WAD * 150n) / 100n;
export const DANGER_RATIO = (WAD * 130n) / 100n;
/** BTC kept back for network fees when the user taps "Max". */
export const GAS_RESERVE = 10n ** 15n; // 0.001 BTC

export interface BorrowParams {
  /** Block every value was read at. */
  block: bigint;
  /** USD per BTC, 18 decimals, from Mezo's PriceFeed (the same price the contract will use). */
  price: bigint;
  recoveryMode: boolean;
  minNetDebt: bigint;
  /** One-time fee, 18-decimal fraction (1e15 = 0.1%). Zero in recovery mode. */
  borrowingRate: bigint;
  gasCompensation: bigint;
  mcr: bigint;
  ccr: bigint;
  /** Basis points per year, simple interest. */
  interestBps: number;
}

export interface Trove {
  active: boolean;
  coll: bigint;
  /** principal + interest, including pending redistribution. */
  debt: bigint;
  principal: bigint;
  maxBorrowingCapacity: bigint;
}

// ---------- pure math (mirrors BorrowerOperations; all bigint) ----------

export const borrowingFee = (debt: bigint, p: Pick<BorrowParams, "borrowingRate" | "recoveryMode">) =>
  p.recoveryMode ? 0n : (debt * p.borrowingRate) / WAD;

/** Everything the new loan adds to the user's debt: amount received + fee + gas deposit. */
export const totalDebtFor = (debt: bigint, p: Pick<BorrowParams, "borrowingRate" | "recoveryMode" | "gasCompensation">) =>
  debt + borrowingFee(debt, p) + p.gasCompensation;

/** Collateral ratio, 18-decimal fraction (1.5e18 = 150%). */
export const ratioOf = (coll: bigint, debt: bigint, price: bigint) => (debt === 0n ? 0n : (coll * price) / debt);

/** Nominal ratio used to place the loan in Mezo's sorted list (no price). */
export const nicrOf = (coll: bigint, principal: bigint) => (principal === 0n ? 0n : (coll * 10n ** 20n) / principal);

/** BTC price (USD, 18 decimals) at which the loan falls to the minimum ratio and can be liquidated. */
export const liquidationPrice = (coll: bigint, debt: bigint, mcr: bigint) => (coll === 0n ? 0n : (debt * mcr + coll - 1n) / coll);

/** Largest amount to receive so the new loan sits at `ratio`, before the minimum-size check. */
export function maxDebtAtRatio(coll: bigint, ratio: bigint, p: BorrowParams): bigint {
  // coll*price/ratio = debt*(1+rate) + gas  =>  debt = (coll*price/ratio - gas) / (1+rate)
  const cap = (coll * p.price) / ratio;
  if (cap <= p.gasCompensation) return 0n;
  const rate = p.recoveryMode ? 0n : p.borrowingRate;
  return ((cap - p.gasCompensation) * WAD) / (WAD + rate);
}

/** BTC needed to receive `debt` at `ratio`, rounded up. */
export const collForDebt = (debt: bigint, ratio: bigint, p: BorrowParams) => {
  const total = totalDebtFor(debt, p);
  return (total * ratio + p.price - 1n) / p.price;
};

/** Smallest amount a new loan can pay out, given Mezo's minimum net debt (debt + fee). */
export const minReceivable = (p: BorrowParams) => {
  const rate = p.recoveryMode ? 0n : p.borrowingRate;
  return (p.minNetDebt * WAD + WAD + rate - 1n) / (WAD + rate);
};

export type OpenCheck =
  | { ok: true; fee: bigint; total: bigint; ratio: bigint; liquidation: bigint }
  | { ok: false; reason: string };

/** Same checks BorrowerOperations runs on openTrove, so the form can explain a revert before it happens. */
export function checkOpen(coll: bigint, debt: bigint, p: BorrowParams): OpenCheck {
  if (debt <= 0n || coll <= 0n) return { ok: false, reason: "Enter how much BTC to lock and how much MUSD to borrow." };
  const fee = borrowingFee(debt, p);
  if (debt + fee < p.minNetDebt) return { ok: false, reason: `Mezo's minimum loan is ${fmt(minReceivable(p))} MUSD.` };
  const total = debt + fee + p.gasCompensation;
  const ratio = ratioOf(coll, total, p.price);
  const floor = p.recoveryMode ? p.ccr : p.mcr;
  if (ratio < floor) {
    return {
      ok: false,
      reason: p.recoveryMode
        ? "Mezo is in recovery mode, so new loans need a collateral ratio of at least 150%. Lock more BTC or borrow less."
        : "That's below Mezo's 110% minimum. Lock more BTC or borrow less.",
    };
  }
  return { ok: true, fee, total, ratio, liquidation: liquidationPrice(coll, total, p.mcr) };
}

export type DrawCheck =
  | { ok: true; fee: bigint; total: bigint; ratio: bigint; liquidation: bigint }
  | { ok: false; reason: string };

/** Borrowing more on an existing loan (withdrawMUSD). Mezo also caps total debt at the capacity set when it opened. */
export function checkDraw(trove: Trove, amount: bigint, p: BorrowParams): DrawCheck {
  if (amount <= 0n) return { ok: false, reason: "Enter how much more MUSD to borrow." };
  // In recovery mode Mezo rejects any change that lowers a loan's ratio, which borrowing more without adding BTC always does.
  if (p.recoveryMode) return { ok: false, reason: "Mezo is in recovery mode, so existing loans can't borrow more right now." };
  const fee = borrowingFee(amount, p);
  const total = trove.debt + amount + fee;
  if (total > trove.maxBorrowingCapacity) {
    return { ok: false, reason: `Your loan can carry at most ${fmt(trove.maxBorrowingCapacity)} MUSD of debt. Mezo sets that limit when the loan opens.` };
  }
  const ratio = ratioOf(trove.coll, total, p.price);
  if (ratio < p.mcr) return { ok: false, reason: "That would take your loan below Mezo's 110% minimum." };
  return { ok: true, fee, total, ratio, liquidation: liquidationPrice(trove.coll, total, p.mcr) };
}

const fmt = (wei: bigint) => (Number(wei / 10n ** 16n) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

// ---------- chain reads ----------

/**
 * Mezo testnet's public RPC load-balances over a node that can lag far behind; reads served by it revert with
 * "PriceFeed: Oracle is stale." (the price is older than 60s at that block). Retry until a node at the head answers.
 */
export async function withRetry<T>(fn: () => Promise<T>, tries = 6): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  throw last;
}

/** Reads every parameter at one block, so price, mode and fees are consistent with each other. */
export async function readBorrowParams(client: PublicClient, c: MezoBorrowContracts): Promise<BorrowParams> {
  return withRetry(async () => {
    const block = await client.getBlockNumber({ cacheTime: 0 });
    const at = { blockNumber: block } as const;
    const bo = { address: c.borrowerOperations, abi: borrowerOperationsAbi } as const;
    const [price, minNetDebt, borrowingRate, gasCompensation, mcr, ccr, interestBps] = await Promise.all([
      client.readContract({ address: c.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice", ...at }),
      client.readContract({ ...bo, functionName: "minNetDebt", ...at }),
      client.readContract({ ...bo, functionName: "borrowingRate", ...at }),
      client.readContract({ ...bo, functionName: "MUSD_GAS_COMPENSATION", ...at }),
      client.readContract({ ...bo, functionName: "MCR", ...at }),
      client.readContract({ ...bo, functionName: "CCR", ...at }),
      client.readContract({ address: c.interestRateManager, abi: interestRateAbi, functionName: "interestRate", ...at }),
    ]);
    const recoveryMode = await client.readContract({
      address: c.troveManager,
      abi: troveManagerAbi,
      functionName: "checkRecoveryMode",
      args: [price],
      ...at,
    });
    return { block, price, recoveryMode, minNetDebt, borrowingRate, gasCompensation, mcr, ccr, interestBps: Number(interestBps) };
  });
}

export async function readTrove(client: PublicClient, c: MezoBorrowContracts, owner: Address): Promise<Trove> {
  return withRetry(async () => {
    const tm = { address: c.troveManager, abi: troveManagerAbi } as const;
    const status = await client.readContract({ ...tm, functionName: "getTroveStatus", args: [owner] });
    if (status !== TROVE_ACTIVE) return { active: false, coll: 0n, debt: 0n, principal: 0n, maxBorrowingCapacity: 0n };
    const [[coll, principal, interest, pColl, pPrincipal, pInterest], maxBorrowingCapacity] = await Promise.all([
      client.readContract({ ...tm, functionName: "getEntireDebtAndColl", args: [owner] }),
      client.readContract({ ...tm, functionName: "getTroveMaxBorrowingCapacity", args: [owner] }),
    ]);
    return {
      active: true,
      coll: coll + pColl,
      principal: principal + pPrincipal,
      debt: principal + pPrincipal + interest + pInterest,
      maxBorrowingCapacity,
    };
  });
}

/**
 * Where the loan slots into Mezo's sorted list. A stale hint only costs gas; the contract re-checks it.
 * `nicr` = collateral * 1e20 / principal (interest excluded), as the contract computes it.
 */
export async function findHints(client: PublicClient, c: MezoBorrowContracts, nicr: bigint): Promise<[Address, Address]> {
  // Hints only save gas. If the lookup fails, zero hints make the contract walk the list itself, which is still correct.
  return withRetry(async () => {
    const size = await client.readContract({ address: c.sortedTroves, abi: sortedTrovesAbi, functionName: "getSize" });
    const trials = BigInt(Math.max(15, Math.ceil(15 * Math.sqrt(Number(size)))));
    const seed = BigInt(Math.floor(Math.random() * 1e9));
    const [hint] = await client.readContract({
      address: c.hintHelpers,
      abi: hintHelpersAbi,
      functionName: "getApproxHint",
      args: [nicr, trials, seed],
    });
    const [upper, lower] = await client.readContract({
      address: c.sortedTroves,
      abi: sortedTrovesAbi,
      functionName: "findInsertPosition",
      args: [nicr, hint, hint],
    });
    return [upper, lower] as [Address, Address];
  }, 3).catch((): [Address, Address] => [zeroAddress, zeroAddress]);
}

/** Plain messages for BorrowerOperations' require strings. */
export function explainBorrowRevert(msg: string): string | null {
  if (/oracle is stale/i.test(msg)) return "Mezo's BTC price feed didn't answer in time. Try again in a moment.";
  if (/ICR < MCR|ICR >= CCR|TCR < CCR/i.test(msg)) return "The BTC price moved and this loan would be under Mezo's minimum ratio. Lock more BTC or borrow less.";
  if (/net debt must be greater than minimum/i.test(msg)) return "That's under Mezo's minimum loan size.";
  if (/Recovery Mode/i.test(msg)) return "Mezo is in recovery mode right now, which blocks this change.";
  if (/Trove is active/i.test(msg)) return "This wallet already has a Mezo loan. Borrow more on it instead.";
  if (/maxBorrowingCapacity/i.test(msg)) return "That's more than your loan's borrowing limit on Mezo.";
  return null;
}

export interface PreparedCall {
  functionName: "openTrove" | "withdrawMUSD";
  args: readonly [bigint, Address, Address];
  value: bigint;
  gas: bigint;
  /** What the checks saw at the fresh block, for the confirmation summary. */
  check: { fee: bigint; total: bigint; ratio: bigint; liquidation: bigint };
}

/**
 * Re-reads price and parameters at the latest block, re-runs the contract's checks, finds hints and estimates gas,
 * right before the wallet prompt. Gas is passed explicitly so the wallet doesn't estimate against a lagging node.
 * `minRatio` is the user's floor: if the price moved and the loan would now sit below it, this throws instead.
 */
export async function prepareOpen(
  client: PublicClient,
  c: MezoBorrowContracts,
  account: Address,
  coll: bigint,
  debt: bigint,
  minRatio: bigint,
): Promise<PreparedCall> {
  const p = await readBorrowParams(client, c);
  const chk = checkOpen(coll, debt, p);
  if (!chk.ok) throw new Error(chk.reason);
  if (chk.ratio < minRatio) throw new Error("The BTC price moved and this loan's ratio dropped. Review the new numbers and try again.");
  const [upper, lower] = await findHints(client, c, nicrOf(coll, chk.total));
  const args = [debt, upper, lower] as const;
  const gas = await estimate(client, { address: c.borrowerOperations, functionName: "openTrove", args, value: coll, account });
  return { functionName: "openTrove", args, value: coll, gas, check: chk };
}

export async function prepareDraw(
  client: PublicClient,
  c: MezoBorrowContracts,
  account: Address,
  amount: bigint,
  minRatio: bigint,
): Promise<PreparedCall> {
  const [p, trove] = await Promise.all([readBorrowParams(client, c), readTrove(client, c, account)]);
  if (!trove.active) throw new Error("This wallet has no open Mezo loan.");
  const chk = checkDraw(trove, amount, p);
  if (!chk.ok) throw new Error(chk.reason);
  if (chk.ratio < minRatio) throw new Error("The BTC price moved and this loan's ratio dropped. Review the new numbers and try again.");
  const fee = borrowingFee(amount, p);
  const [upper, lower] = await findHints(client, c, nicrOf(trove.coll, trove.principal + amount + fee));
  const args = [amount, upper, lower] as const;
  const gas = await estimate(client, { address: c.borrowerOperations, functionName: "withdrawMUSD", args, value: 0n, account });
  return { functionName: "withdrawMUSD", args, value: 0n, gas, check: chk };
}

async function estimate(
  client: PublicClient,
  call: { address: Address; functionName: "openTrove" | "withdrawMUSD"; args: readonly [bigint, Address, Address]; value: bigint; account: Address },
): Promise<bigint> {
  // A revert with a reason (ratio, minimum, active loan) is final; only node/oracle hiccups are retried.
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      const g =
        call.functionName === "openTrove"
          ? await client.estimateContractGas({ address: call.address, abi: borrowerOperationsAbi, functionName: "openTrove", args: call.args, value: call.value, account: call.account })
          : await client.estimateContractGas({ address: call.address, abi: borrowerOperationsAbi, functionName: "withdrawMUSD", args: call.args, account: call.account });
      return (g * 125n) / 100n;
    } catch (e) {
      last = e;
      const msg = e instanceof Error ? e.message : String(e);
      const known = explainBorrowRevert(msg);
      if (known && !/oracle is stale/i.test(msg)) throw new Error(known);
      await new Promise((r) => setTimeout(r, 150 * (i + 1)));
    }
  }
  const msg = last instanceof Error ? last.message : String(last);
  throw new Error(explainBorrowRevert(msg) ?? (/insufficient funds/i.test(msg) ? "Not enough BTC in this wallet for the collateral plus network fees." : "Mezo's network didn't respond. Try again in a moment."));
}
