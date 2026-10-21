import { describe, expect, it } from "vitest";
import { buildFigures, normalizeNumbers, periodDates, textCounts, type GrantNumbers } from "@/lib/grants";

const today = new Date(2026, 9, 21);

describe("periodDates", () => {
  it("works out each preset", () => {
    expect(periodDates("this_year", { from: "", to: "" }, today)).toEqual({ from: "2026-01-01", to: "2026-10-21" });
    expect(periodDates("last_year", { from: "", to: "" }, today)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(periodDates("last_12_months", { from: "", to: "" }, today)).toEqual({ from: "2025-10-22", to: "2026-10-21" });
    expect(periodDates("all", { from: "", to: "" }, today)).toEqual({ from: null, to: "2026-10-21" });
    expect(periodDates("custom", { from: "2026-03-01", to: "2026-06-30" }, today)).toEqual({ from: "2026-03-01", to: "2026-06-30" });
  });
});

describe("textCounts", () => {
  it("counts words and characters", () => {
    expect(textCounts("  We feed   families.\nEvery week. ")).toEqual({ words: 5, characters: 34 });
    expect(textCounts("")).toEqual({ words: 0, characters: 0 });
  });
});

describe("buildFigures", () => {
  const numbers = normalizeNumbers({
    from: "2026-01-01",
    to: "2026-10-21",
    totals: {
      raised: "5000" as unknown as number,
      gifts: 20,
      donors: 12,
      hours: 100,
      volunteers: 8,
      sessions: 30,
      responses: 0,
      people_served: 250,
      services_count: 400,
      people_helped: 240,
      services_value: 0,
    },
    previous: null,
    new_people: 60,
    outcomes: [{ label: "Food security", form_title: "Check-in", measured: 40, improved: 30, same: 5, worse: 5 }],
  } as GrantNumbers);

  it("writes ready-to-paste sentences and leaves out zeros", () => {
    const figures = buildFigures(numbers, "In 2026", 31.8);
    const keys = figures.map((f) => f.key);
    expect(keys).toContain("people_served");
    expect(keys).not.toContain("responses");
    expect(keys).not.toContain("help_value");
    expect(figures.find((f) => f.key === "people_served")!.sentence).toBe("In 2026, we served 250 people.");
    expect(figures.find((f) => f.key.startsWith("outcome:"))!.value).toBe("75%");
    expect(figures.find((f) => f.key === "volunteer_value")!.value).toBe("$3,180.00");
    expect(figures.find((f) => f.key === "raised")!.sentence).toContain("$5,000");
  });

  it("skips volunteer value without a rate", () => {
    expect(buildFigures(numbers, "In 2026", null).some((f) => f.key === "volunteer_value")).toBe(false);
  });
});
