import { describe, expect, it } from "vitest";
import { formatCardNumber, parseCardNumber, parseScan } from "@/lib/cards";

const ID = "3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b";

describe("card numbers", () => {
  it("formats with and without a prefix", () => {
    expect(formatCardNumber("FB", 123)).toBe("FB-000123");
    expect(formatCardNumber(null, 7)).toBe("000007");
  });

  it("reads what people type", () => {
    expect(parseCardNumber("FB-000123")).toBe(123);
    expect(parseCardNumber("fb 123")).toBe(123);
    expect(parseCardNumber("000123")).toBe(123);
    expect(parseCardNumber("FB000123")).toBe(123);
    expect(parseCardNumber("Maria")).toBeNull();
    expect(parseCardNumber("036000291452")).toBeNull(); // too long: a product barcode
  });
});

describe("parseScan", () => {
  it("recognizes our person and item links from any site address", () => {
    expect(parseScan(`https://app.hummotion.com/scan/person/${ID}`)).toEqual({ kind: "person", id: ID });
    expect(parseScan(`http://localhost:5174/scan/item/${ID.toUpperCase()}?x=1`)).toEqual({ kind: "item", id: ID });
  });

  it("treats anything else as a product barcode", () => {
    expect(parseScan(" 036000291452 ")).toEqual({ kind: "barcode", code: "036000291452" });
  });

  it("ignores empty or broken links", () => {
    expect(parseScan("   ")).toBeNull();
    expect(parseScan("https://x.org/scan/person/not-an-id")).toEqual({ kind: "barcode", code: "https://x.org/scan/person/not-an-id" });
  });
});
