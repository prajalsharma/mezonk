import { describe, expect, it } from "vitest";
import { ONE, cost, feeOf, sharesForBudget } from "@/lib/orderbook/math";
import { formatDuration } from "@/lib/format";
import { describeEvent } from "@/components/markets/ActivityList";
import type { EventDto } from "@/lib/api/types";

describe("sharesForBudget", () => {
  const levels = [
    { price: 42, shares: 50n * ONE },
    { price: 40, shares: 10n * ONE },
  ];

  it("walks best price first and never spends more than the budget, fee included", () => {
    const budget = 20n * ONE;
    const r = sharesForBudget(levels, budget, 100);
    const spent = cost(10n * ONE, 40) + cost(r.qty - 10n * ONE, 42);
    expect(spent + feeOf(spent, 100)).toBeLessThanOrEqual(budget);
    expect(r.worst).toBe(42);
    expect(r.exhausted).toBe(false);
    expect(r.qty % 10n ** 16n).toBe(0n);
  });

  it("reports when the book runs out first", () => {
    const r = sharesForBudget(levels, 1000n * ONE, 100);
    expect(r.qty).toBe(60n * ONE);
    expect(r.exhausted).toBe(true);
  });

  it("buys nothing from an empty book", () => {
    expect(sharesForBudget([], 5n * ONE, 100)).toEqual({ qty: 0n, worst: null, exhausted: true });
  });
});

describe("formatDuration", () => {
  it("keeps round units and never prints thousands of minutes", () => {
    expect(formatDuration(86400 * 2)).toBe("2 days");
    expect(formatDuration(7941 * 60)).toBe("5d 12h");
    expect(formatDuration(3600 + 120)).toBe("1h 2m");
  });
});

describe("describeEvent", () => {
  const ev = (eventName: string, args: Record<string, unknown>) =>
    ({ id: 1, eventName, args, actor: "0x1111111111111111111111111111111111111111" }) as unknown as EventDto;

  it("speaks in trades, not event names", () => {
    expect(describeEvent(ev("TakeSettled", { side: 0, outcome: 0, filled: String(30n * ONE), notional: String(cost(30n * ONE, 41)) }))).toMatch(/bought 30(\.00)? Yes at 41¢$/);
    expect(describeEvent(ev("Fill", {}))).toBeNull();
    expect(describeEvent(ev("SomethingNew", {}))).toBe("Something New");
  });
});
