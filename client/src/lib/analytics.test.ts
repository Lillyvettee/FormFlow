import { describe, expect, it } from "vitest";
import { change, dataReadiness, planItem, projectYearEnd, sortPlans, type Analytics, type AnalyticsItem } from "@/lib/analytics";

const item = (over: Partial<AnalyticsItem> = {}): AnalyticsItem => ({
  id: "1",
  name: "Rice",
  unit: "bags",
  category: null,
  quantity: 30,
  target_quantity: null,
  used_30: 0,
  used_90: 90,
  received_90: 0,
  history_days: 90,
  last_used: null,
  ...over,
});
const today = new Date("2026-10-20T12:00:00Z");

describe("planItem", () => {
  it("plans by weeks of use when there's no target", () => {
    const p = planItem(item(), 4, today); // 1 a day, 30 in stock
    expect(p.dailyUse).toBe(1);
    expect(p.daysLeft).toBe(30);
    expect(p.suggested).toBe(0); // 28 days of use covered
    expect(planItem(item(), 6, today).suggested).toBe(12); // 42 needed - 30
    expect(p.basis).toBe("weeks");
  });

  it("buys up to the target level when one is set", () => {
    const p = planItem(item({ target_quantity: 50 }), 4, today);
    expect(p.suggested).toBe(20);
    expect(p.basis).toBe("target");
    expect(p.status).toBe("buy");
  });

  it("uses fewer days of history for new items", () => {
    expect(planItem(item({ used_90: 14, history_days: 7, quantity: 10 }), 4, today).dailyUse).toBe(2);
  });

  it("flags out of stock and running out this week", () => {
    expect(planItem(item({ quantity: 0 }), 4, today).status).toBe("out");
    expect(planItem(item({ quantity: 5 }), 4, today).status).toBe("this_week");
  });

  it("doesn't suggest buying items nobody uses", () => {
    const p = planItem(item({ used_90: 0 }), 4, today);
    expect(p.suggested).toBe(0);
    expect(p.daysLeft).toBeNull();
    expect(p.status).toBe("no_usage");
  });

  it("handles numbers sent as strings", () => {
    expect(planItem(item({ quantity: "30" as unknown as number, used_90: "90" as unknown as number }), 4, today).daysLeft).toBe(30);
  });
});

describe("sortPlans", () => {
  it("puts the most urgent first", () => {
    const plans = [item({ id: "a", name: "A", quantity: 100 }), item({ id: "b", name: "B", quantity: 0 }), item({ id: "c", name: "C", quantity: 3 })].map((i) =>
      planItem(i, 4, today),
    );
    expect(sortPlans(plans).map((p) => p.item.id)).toEqual(["b", "c", "a"]);
  });
});

describe("helpers", () => {
  it("works out change and projections", () => {
    expect(change(120, 100)).toBe(20);
    expect(change(5, 0)).toBeNull();
    expect(projectYearEnd(1000, 100, 365)).toBeCloseTo(3650);
    expect(projectYearEnd(1000, 5, 365)).toBeNull();
  });
});

describe("dataReadiness", () => {
  const base = (over: { since?: string | null; months?: number; lastYear?: number; hours?: number }) =>
    ({
      generated_at: "",
      inventory: { items: [], weekly_usage: [], tracking_since: over.since ?? null },
      demand: {
        by_month: Array.from({ length: 12 }, (_, i) => ({ month: `2026-${i + 1}`, people: i < (over.months ?? 0) ? 5 : 0, new_people: 0, help_given: 0 })),
        by_weekday: [],
        people_90: 0,
        people_prev_90: 0,
        new_90: 0,
      },
      fundraising: { by_month: [], ytd: 0, last_ytd: 0, last_year_total: over.lastYear ?? 0, gifts_ytd: 0, donors_ytd: 0, donors_last_year: 0, retained_donors: 0, day_of_year: 1, days_in_year: 365 },
      volunteers: { by_weekday: [{ weekday: 1, hours: over.hours ?? 0 }], by_month: [] },
    }) as Analytics;
  const now = new Date("2026-10-21T12:00:00Z");

  it("says what's still being collected", () => {
    const r = dataReadiness(base({ since: "2026-10-11T12:00:00Z", months: 1 }), now);
    const inv = r.find((s) => s.section === "inventory")!;
    expect(inv.ready).toBe(false);
    expect(inv.progress).toBeCloseTo(10 / 28);
    expect(inv.message).toContain("10 of 28 days");
    expect(r.find((s) => s.section === "demand")!.ready).toBe(false);
    expect(r.find((s) => s.section === "fundraising")!.ready).toBe(false);
    expect(r.find((s) => s.section === "volunteers")!.ready).toBe(false);
  });

  it("is ready once there's enough", () => {
    const r = dataReadiness(base({ since: "2026-09-01T00:00:00Z", months: 3, lastYear: 100, hours: 5 }), now);
    expect(r.every((s) => s.ready)).toBe(true);
  });
});
