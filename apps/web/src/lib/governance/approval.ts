import type { Address, Hex } from "viem";

/**
 * EIP-712 market approval. A curator signs this off-chain; MezonkMarkets.createMarket verifies it on-chain
 * (curator must be approved, must not be the creator, approval must match the published market, single use).
 * Field order and names must match MARKET_APPROVAL_TYPEHASH in the contract.
 */
export const approvalTypes = {
  MarketApproval: [
    { name: "metadataHash", type: "bytes32" },
    { name: "creator", type: "address" },
    { name: "resolver", type: "address" },
    { name: "closeTime", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

export interface MarketApproval {
  metadataHash: Hex;
  creator: Address;
  resolver: Address;
  closeTime: bigint;
  deadline: bigint;
  nonce: Hex;
}

export const approvalDomain = (chainId: number, verifyingContract: Address) =>
  ({ name: "MEZONK Markets", version: "1", chainId, verifyingContract }) as const;

/** JSON-safe form for storage and transport. */
export interface StoredApproval {
  metadataHash: Hex;
  creator: Address;
  resolver: Address;
  closeTime: string;
  deadline: string;
  nonce: Hex;
  curator: Address;
  signature: Hex;
}

export const toContractApproval = (a: StoredApproval): MarketApproval => ({
  metadataHash: a.metadataHash,
  creator: a.creator,
  resolver: a.resolver,
  closeTime: BigInt(a.closeTime),
  deadline: BigInt(a.deadline),
  nonce: a.nonce,
});
