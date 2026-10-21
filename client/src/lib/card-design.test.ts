import { describe, expect, it } from "vitest";
import { MAX_CARD_FIELDS, MAX_CARD_LINES, cardSize, cardsPerRow, defaultCardDesign, normalizeCardDesign } from "@/lib/card-design";

describe("normalizeCardDesign", () => {
  it("uses defaults for an empty design, with the branding color as accent", () => {
    expect(normalizeCardDesign({}, "#aa0000")).toEqual(defaultCardDesign("#aa0000"));
    expect(normalizeCardDesign(null).colors.accent).toBe("#0848a9");
  });

  it("keeps valid settings and drops invalid ones", () => {
    const d = normalizeCardDesign({
      title: "Member card",
      layout: "header_band",
      orientation: "sideways",
      colors: { background: "#000000", text: "red", accent: "#00ff00" },
      customFieldIds: ["a", 5, "b"],
      lines: ["Call us", 7],
    });
    expect(d.title).toBe("Member card");
    expect(d.layout).toBe("header_band");
    expect(d.orientation).toBe("landscape");
    expect(d.colors).toEqual({ background: "#000000", text: "#111111", accent: "#00ff00" });
    expect(d.customFieldIds).toEqual(["a", "b"]);
    expect(d.lines).toEqual(["Call us"]);
  });

  it("limits fields and lines", () => {
    const d = normalizeCardDesign({ customFieldIds: ["1", "2", "3", "4", "5", "6"], lines: ["a", "b", "c", "d"] });
    expect(d.customFieldIds).toHaveLength(MAX_CARD_FIELDS);
    expect(d.lines).toHaveLength(MAX_CARD_LINES);
  });
});

describe("card sizes", () => {
  it("is a CR80 badge either way round, and fits Letter", () => {
    expect(cardSize("landscape")).toEqual({ w: 3.375, h: 2.125 });
    expect(cardSize("portrait")).toEqual({ w: 2.125, h: 3.375 });
    // 7.5in printable width (8.5in minus 0.5in margins each side).
    for (const o of ["landscape", "portrait"] as const) expect(cardsPerRow(o) * cardSize(o).w).toBeLessThanOrEqual(7.5);
  });
});
