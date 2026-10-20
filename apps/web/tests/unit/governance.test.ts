import { describe, expect, it } from "vitest";
import { canTransition, proposalInputSchema, reviewActionSchema, REVIEW_CHECKLIST, TRANSITIONS, PROPOSAL_STATUS } from "../../src/lib/governance/proposal";
import { approvalDomain, approvalTypes, toContractApproval } from "../../src/lib/governance/approval";
import { metadataHash, serializeMetadata } from "../../src/lib/market/metadata";

const metadata = {
  v: 1 as const,
  question: "Will Mezo mainnet TVL exceed $500M on 31 Mar 2027 (UTC)?",
  category: "defi" as const,
  description: "",
  rules: {
    yes: "DefiLlama's Mezo chain page shows TVL above 500,000,000 USD at 31 Mar 2027 00:00 UTC.",
    no: "That page shows TVL at or below 500,000,000 USD at that time.",
    invalid: "DefiLlama stops tracking Mezo, or shows no figure for 7 days after the date.",
    ambiguity: "",
  },
  source: { name: "DefiLlama", url: "https://defillama.com/chain/Mezo" },
  resolvesAt: "2027-03-31T00:00:00.000Z",
};

describe("proposal lifecycle", () => {
  it("only the documented transitions are allowed", () => {
    expect(canTransition("submit", "draft")).toBe(true);
    expect(canTransition("submit", "changes_requested")).toBe(true);
    expect(canTransition("submit", "approved")).toBe(false);
    expect(canTransition("approve", "under_review")).toBe(true);
    expect(canTransition("approve", "approved")).toBe(false);
    expect(canTransition("approve", "rejected")).toBe(false);
    expect(canTransition("withdraw", "approved")).toBe(false);
    expect(canTransition("withdraw", "under_review")).toBe(true);
    expect(canTransition("publish", "approved")).toBe(true);
    expect(canTransition("publish", "submitted")).toBe(false);
    expect(canTransition("nonsense", "draft")).toBe(false);
  });

  it("nothing reaches published except through approved/scheduled, and nothing leaves a final state", () => {
    const toPublished = Object.values(TRANSITIONS).filter((t) => t.to === "published");
    expect(toPublished).toHaveLength(1);
    expect(toPublished[0]!.from.sort()).toEqual(["approved", "scheduled"]);
    for (const final of ["published", "rejected", "withdrawn"] as const) {
      for (const action of Object.keys(TRANSITIONS)) expect(canTransition(action, final)).toBe(false);
    }
    // Every status is reachable or initial.
    const reachable = new Set(["draft", ...Object.values(TRANSITIONS).map((t) => t.to)]);
    for (const s of PROPOSAL_STATUS) expect(reachable.has(s)).toBe(true);
  });

  it("curators never trigger author transitions and vice versa", () => {
    expect(TRANSITIONS.submit!.by).toBe("author");
    expect(TRANSITIONS.withdraw!.by).toBe("author");
    for (const a of ["claim", "request_changes", "reject", "approve"]) expect(TRANSITIONS[a]!.by).toBe("curator");
    expect(TRANSITIONS.publish!.by).toBe("system");
  });
});

describe("proposal input", () => {
  const base = { metadata, closeTime: "2027-03-30T00:00:00.000Z", rationale: "Measures adoption of the chain, which matters to every MUSD holder." };

  it("accepts a complete proposal with defaults", () => {
    const p = proposalInputSchema.parse(base);
    expect(p.outcomeType).toBe("binary");
    expect(p.references).toEqual([]);
    expect(p.sponsored).toBe(false);
  });
  it("rejects a short rationale, http references and bad project ids", () => {
    expect(() => proposalInputSchema.parse({ ...base, rationale: "short" })).toThrow();
    expect(() => proposalInputSchema.parse({ ...base, references: [{ url: "http://x.org", label: "" }] })).toThrow();
    expect(() => proposalInputSchema.parse({ ...base, projectId: "Not Valid" })).toThrow();
    expect(() => proposalInputSchema.parse({ ...base, resolver: "0x123" })).toThrow();
  });
  it("caps references at 8", () => {
    const references = Array.from({ length: 9 }, (_, i) => ({ url: `https://x.org/${i}`, label: "" }));
    expect(() => proposalInputSchema.parse({ ...base, references })).toThrow();
  });
});

describe("review actions", () => {
  it("parses every action and rejects unknown ones", () => {
    for (const action of ["claim", "request_changes", "reject", "approve", "note", "unassign", "assign"]) {
      expect(reviewActionSchema.parse({ action }).action).toBe(action);
    }
    expect(() => reviewActionSchema.parse({ action: "publish" })).toThrow();
    expect(() => reviewActionSchema.parse({ action: "delete" })).toThrow();
  });
  it("signature must be hex and assign addresses must be addresses", () => {
    expect(() => reviewActionSchema.parse({ action: "approve", signature: "nope" })).toThrow();
    expect(() => reviewActionSchema.parse({ action: "assign", resolver: "0xabc" })).toThrow();
    expect(reviewActionSchema.parse({ action: "assign", resolver: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" }).resolver).toBeDefined();
  });
  it("checklist has the seven required items in the documented order", () => {
    expect(REVIEW_CHECKLIST.map(([k]) => k)).toEqual(["objective", "source", "deadline", "invalid", "duplicate", "policy", "conflict"]);
  });
});

describe("EIP-712 approval", () => {
  it("type layout matches the contract's MARKET_APPROVAL_TYPEHASH field order", () => {
    expect(approvalTypes.MarketApproval.map((f) => `${f.type} ${f.name}`)).toEqual([
      "bytes32 metadataHash",
      "address creator",
      "address resolver",
      "uint64 closeTime",
      "uint64 deadline",
      "bytes32 nonce",
    ]);
    expect(approvalDomain(31611, "0x0000000000000000000000000000000000000001")).toEqual({
      name: "MEZONK Markets",
      version: "1",
      chainId: 31611,
      verifyingContract: "0x0000000000000000000000000000000000000001",
    });
  });
  it("stored approvals convert to bigint fields without losing precision", () => {
    const a = toContractApproval({
      metadataHash: metadataHash(serializeMetadata(metadata)),
      creator: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      resolver: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      closeTime: "1806710400",
      deadline: "1806100000",
      nonce: "0x" + "ab".repeat(32) as `0x${string}`,
      curator: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955",
      signature: "0x00",
    });
    expect(a.closeTime).toBe(1806710400n);
    expect(a.deadline).toBe(1806100000n);
    expect(a.metadataHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
