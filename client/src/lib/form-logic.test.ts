import { describe, expect, it } from "vitest";
import { isFieldVisible } from "@/lib/form-logic";
import type { FormField } from "@/types/database";

/** Minimal fields; only id, type and showIf matter here. */
const field = (id: string, type: string, showIf?: FormField["showIf"]) => ({ id, type, label: id, showIf }) as unknown as FormField;

describe("isFieldVisible", () => {
  const hasKids = field("kids", "checkbox");
  const kidCount = field("count", "number", { fieldId: "kids", op: "is", value: "Yes" });
  const ages = field("ages", "text", { fieldId: "count", op: "answered" });
  const fields = [hasKids, kidCount, ages];

  it("always shows questions without a condition", () => {
    expect(isFieldVisible(hasKids, fields, {})).toBe(true);
  });

  it("treats an untouched Yes/No question as No", () => {
    expect(isFieldVisible(kidCount, fields, {})).toBe(false);
    expect(isFieldVisible(kidCount, fields, { kids: true })).toBe(true);
  });

  it("hides a question when the question it depends on is hidden", () => {
    expect(isFieldVisible(ages, fields, { count: 2 })).toBe(false);
    expect(isFieldVisible(ages, fields, { kids: true, count: 2 })).toBe(true);
  });

  it("ignores case and extra spaces when comparing answers", () => {
    const city = field("city", "text");
    const zone = field("zone", "text", { fieldId: "city", op: "is", value: "San  Antonio" });
    expect(isFieldVisible(zone, [city, zone], { city: " san antonio " })).toBe(true);
  });

  it("shows the question if its condition points at a deleted question", () => {
    const orphan = field("orphan", "text", { fieldId: "gone", op: "is", value: "x" });
    expect(isFieldVisible(orphan, [orphan], {})).toBe(true);
  });

  it("supports is not and left blank", () => {
    const q = field("q", "text");
    const notYes = field("a", "text", { fieldId: "q", op: "is_not", value: "yes" });
    const blank = field("b", "text", { fieldId: "q", op: "not_answered" });
    expect(isFieldVisible(notYes, [q, notYes], { q: "no" })).toBe(true);
    expect(isFieldVisible(notYes, [q, notYes], { q: "YES" })).toBe(false);
    expect(isFieldVisible(blank, [q, blank], {})).toBe(true);
    expect(isFieldVisible(blank, [q, blank], { q: "hi" })).toBe(false);
  });
});
