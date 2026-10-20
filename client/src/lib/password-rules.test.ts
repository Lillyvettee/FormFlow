import { describe, expect, it } from "vitest";
import { PASSWORD_RULES } from "@/lib/password-rules";
import { friendlyWriteError } from "@/lib/db-errors";

const passes = (pw: string) => PASSWORD_RULES.every((rule) => rule.test(pw));

describe("PASSWORD_RULES", () => {
  it("accepts a password that meets every rule", () => {
    expect(passes("Mission#2026")).toBe(true);
  });

  it.each([
    ["too short", "Ab1!"],
    ["no uppercase", "mission#2026"],
    ["no lowercase", "MISSION#2026"],
    ["no number", "Mission#abcd"],
    ["no special character", "Mission2026"],
  ])("rejects a password with %s", (_, pw) => {
    expect(passes(pw)).toBe(false);
  });
});

describe("friendlyWriteError", () => {
  it("replaces security-rule errors with a readable message", () => {
    const msg = friendlyWriteError({ message: 'new row violates row-level security policy for table "forms"' });
    expect(msg).toMatch(/can't make changes/);
  });

  it("passes plan limit messages through unchanged", () => {
    const message = "Your Starter plan includes 50 active forms. Upgrade your plan in Settings to add more.";
    expect(friendlyWriteError({ message, code: "P0001" })).toBe(message);
  });

  it("falls back when there is no message", () => {
    expect(friendlyWriteError(null, "Try again.")).toBe("Try again.");
  });
});
