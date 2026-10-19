import { describe, expect, it } from "vitest";
import { deriveStage } from "@/lib/market/stage";
import { metadataSchema, reviewMetadata } from "@/lib/market/metadata";

const base = { closeTime: new Date(10_000_000), proposalWindow: 3600 };

describe("deriveStage", () => {
  it("walks the lifecycle", () => {
    expect(deriveStage(base, 0).stage).toBe("open");
    expect(deriveStage(base, 10_000_000).stage).toBe("closed");
    expect(deriveStage(base, 10_000_000).finalizable).toBe(false);
    expect(deriveStage(base, 10_000_000 + 3_600_000).finalizable).toBe(true);
    const proposed = { ...base, proposedAt: new Date(10_000_100), challengeDeadline: new Date(20_000_000) };
    expect(deriveStage(proposed, 15_000_000)).toMatchObject({ stage: "proposed", finalizable: false });
    expect(deriveStage(proposed, 20_000_000).finalizable).toBe(true);
    const disputed = { ...proposed, disputedAt: new Date(16_000_000), arbitrationDeadline: new Date(30_000_000) };
    expect(deriveStage(disputed, 17_000_000).stage).toBe("disputed");
    expect(deriveStage({ ...disputed, finalOutcome: 2 }, 0)).toMatchObject({ stage: "resolved", label: "Resolved No" });
    expect(deriveStage({ ...base, finalOutcome: 3 }, 0).stage).toBe("invalid");
  });
});

describe("metadata review", () => {
  const m = metadataSchema.parse({
    v: 1,
    question: "Will Mezo TVL be big soon",
    category: "defi",
    rules: { yes: "TVL is big on the DefiLlama Mezo page.", no: "TVL is not big on that page at all.", invalid: "DefiLlama stops tracking Mezo entirely." },
    source: { name: "DefiLlama", url: "https://defillama.com/chain/Mezo" },
    resolvesAt: "2026-12-01T00:00:00.000Z",
  });
  it("blocks vague wording and missing question mark", () => {
    const issues = reviewMetadata(m, new Date("2026-11-01"));
    expect(issues.some((i) => i.blocking && i.message.includes("question"))).toBe(true);
    expect(issues.some((i) => i.blocking && /soon|big/.test(i.message))).toBe(true);
  });
  it("blocks resolution before close", () => {
    expect(reviewMetadata(m, new Date("2027-01-01")).some((i) => i.field === "resolvesAt")).toBe(true);
  });
  it("rejects non-https sources", () => {
    expect(metadataSchema.safeParse({ ...m, source: { name: "x", url: "http://x.com" } }).success).toBe(false);
  });
});
