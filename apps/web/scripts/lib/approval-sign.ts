/**
 * Shared test/seed helper: sign a MarketApproval as a curator and build MezonkMarketFactory.createMarket args.
 * `contract` is the factory (the EIP-712 verifying contract). Only ever used with public anvil test keys locally.
 */
import { keccak256, toBytes, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { approvalDomain, approvalTypes, type MarketApproval } from "../../src/lib/governance/approval";

export interface CreateParams {
  metadata: string;
  closeTime: bigint;
  resolver: Address;
  policyId: number;
}

let counter = 0;

export async function signedCreateArgs(
  curatorPk: Hex,
  chainId: number,
  contract: Address,
  creator: Address,
  p: CreateParams,
  nowSec: bigint,
): Promise<readonly [CreateParams, MarketApproval, Address, Hex]> {
  const curator = privateKeyToAccount(curatorPk);
  const approval: MarketApproval = {
    metadataHash: keccak256(toBytes(p.metadata)),
    creator,
    resolver: p.resolver,
    closeTime: p.closeTime,
    policyId: p.policyId,
    deadline: nowSec + 86_400n,
    nonce: keccak256(toBytes(`seed:${Date.now()}:${++counter}`)),
  };
  const signature = await curator.signTypedData({
    domain: approvalDomain(chainId, contract),
    types: approvalTypes,
    primaryType: "MarketApproval",
    message: approval,
  });
  return [p, approval, curator.address, signature] as const;
}

export const ANVIL_CURATOR_PK = "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356" as const; // anvil #7
export const ANVIL_CREATOR_PK = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6" as const; // anvil #3
