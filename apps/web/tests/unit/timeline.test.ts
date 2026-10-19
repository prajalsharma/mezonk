import { describe, expect, it } from "vitest";
import { buildTimeline, type TimelineEventInput } from "@/lib/market/timeline";

const t = (s: number) => new Date(s * 1000).toISOString();
const m = {
  createdAt: t(0),
  createdTx: "0xc0",
  creator: "0xc",
  closeTime: t(1000),
  proposalWindow: 100,
  challengeWindow: 50,
  arbitrationWindow: 200,
};
const ev = (eventName: string, at: number, args: Record<string, unknown>, actor = "0xa"): TimelineEventInput => ({
  eventName,
  blockTime: t(at),
  txHash: `0x${eventName}`,
  actor,
  args,
});

describe("buildTimeline", () => {
  it("open market: creation plus a pending close, nothing invented", () => {
    const tl = buildTimeline(m, [], 500_000);
    expect(tl.map((e) => e.kind)).toEqual(["created", "closed"]);
    expect(tl[1]).toMatchObject({ source: "derived", status: "pending" });
  });

  it("lapsed proposal window is surfaced as lapsed, not as an event", () => {
    const tl = buildTimeline(m, [], 1_200_000);
    const d = tl.find((e) => e.kind === "proposal-deadline")!;
    expect(d).toMatchObject({ status: "lapsed", source: "derived" });
    expect(d.txHash).toBeUndefined();
  });

  it("full disputed path in order, chain entries carry tx hashes and evidence", () => {
    const events = [
      ev("MarketFinalized", 1_200, { outcome: 2, reason: 1 }),
      ev("OutcomeProposed", 1_010, { outcome: 1, evidenceHash: "0xe1", evidenceURI: "https://x/1", challengeDeadline: 1_060 }, "0xr"),
      ev("DisputeArbitrated", 1_200, { outcome: 2, rationaleHash: "0xe3", rationaleURI: "https://x/3" }, "0xarb"),
      ev("OutcomeDisputed", 1_020, { evidenceHash: "0xe2", evidenceURI: "https://x/2", arbitrationDeadline: 1_220 }, "0xd"),
      ev("Redeemed", 1_300, { payout: "5000000000000000000" }, "0xu"),
    ];
    const tl = buildTimeline(m, events, 2_000_000);
    expect(tl.map((e) => e.kind)).toEqual([
      "created",
      "closed",
      "proposed",
      "challenge-window",
      "disputed",
      "arbitration-window",
      "arbitrated",
      "finalized",
      "claims-open",
      "redeemed",
    ]);
    expect(tl.find((e) => e.kind === "proposed")!.evidence).toEqual({ hash: "0xe1", uri: "https://x/1" });
    expect(tl.find((e) => e.kind === "arbitrated")!.evidence?.hash).toBe("0xe3");
    expect(tl.find((e) => e.kind === "challenge-window")!.deadline).toBe(t(1_060));
    expect(tl.filter((e) => e.source === "chain").every((e) => e.txHash)).toBe(true);
    expect(tl.filter((e) => e.source === "derived").every((e) => !e.txHash)).toBe(true);
  });

  it("arbitration timeout shows as lapsed until finalized", () => {
    const events = [
      ev("OutcomeProposed", 1_010, { outcome: 1, evidenceHash: "0x1", challengeDeadline: 1_060 }),
      ev("OutcomeDisputed", 1_020, { evidenceHash: "0x2", arbitrationDeadline: 1_220 }),
    ];
    const tl = buildTimeline(m, events, 1_300_000);
    expect(tl.find((e) => e.kind === "arbitration-window")).toMatchObject({ status: "lapsed" });
  });
});
