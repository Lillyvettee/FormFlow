/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PLANS,
  PLAN_ORDER,
  YEARLY_DISCOUNT_PERCENT,
  billingLabel,
  formatDollars,
  formatLimit,
  monthlyEquivalent,
  type PlanLimits,
} from "@/lib/plans";

describe("plan prices", () => {
  it("charges the agreed monthly prices", () => {
    expect(PLANS.starter.monthlyPrice).toBe(49);
    expect(PLANS.mission.monthlyPrice).toBe(199);
    expect(PLANS.enterprise.monthlyPrice).toBeNull();
  });

  it("makes yearly 20% off twelve months, rounded down to whole dollars", () => {
    expect(YEARLY_DISCOUNT_PERCENT).toBe(20);
    for (const id of ["starter", "mission"] as const) {
      const plan = PLANS[id];
      const expected = Math.floor(plan.monthlyPrice! * 12 * (1 - YEARLY_DISCOUNT_PERCENT / 100));
      expect(plan.yearlyPrice).toBe(expected);
    }
  });

  it("shows the per-month equivalent for each billing period", () => {
    expect(monthlyEquivalent(PLANS.starter, "monthly")).toBe(49);
    expect(monthlyEquivalent(PLANS.starter, "yearly")).toBe(39);
    expect(monthlyEquivalent(PLANS.mission, "yearly")).toBe(159);
    expect(monthlyEquivalent(PLANS.enterprise, "yearly")).toBeNull();
  });

  it("labels how each plan is billed", () => {
    expect(billingLabel(PLANS.starter, "monthly")).toBe("Billed monthly");
    expect(billingLabel(PLANS.mission, "yearly")).toBe("Billed $1,910/year");
    expect(billingLabel(PLANS.enterprise, "monthly")).toBe("Custom pricing");
  });

  it("formats dollars and limits", () => {
    expect(formatDollars(1910)).toBe("$1,910");
    expect(formatLimit(null)).toBe("Unlimited");
    expect(formatLimit(500)).toBe("500");
  });
});

describe("plan limits and features", () => {
  it("keeps the agreed limits", () => {
    expect(PLANS.starter.limits).toEqual({ forms: 50, members: 2, people: 200, reports: 50 });
    expect(PLANS.mission.limits).toEqual({ forms: 100, members: 10, people: 500, reports: 100 });
    expect(Object.values(PLANS.enterprise.limits).every((v) => v === null)).toBe(true);
  });

  it("leaves import, export, branding, advanced funder portals and scanning out of Starter only", () => {
    const all = { importExport: true, branding: true, funderAdvanced: true, cardsScanning: true };
    expect(PLANS.starter.features).toEqual({ importExport: false, branding: false, funderAdvanced: false, cardsScanning: false });
    expect(PLANS.mission.features).toEqual(all);
    expect(PLANS.enterprise.features).toEqual(all);
  });

  it("lists plans from smallest to largest", () => {
    expect(PLAN_ORDER).toEqual(["starter", "mission", "enterprise"]);
  });

  // The database enforces the limits (plan_limit() in migration 016). If
  // someone changes one side only, the app would promise one number and the
  // database allow another.
  it("matches plan_limit() in the database migration", () => {
    const sql = readFileSync(
      fileURLToPath(new URL("../../../supabase/migrations/016_plans_and_limits.sql", import.meta.url)),
      "utf8",
    );
    const body = sql.slice(sql.indexOf("function public.plan_limit"), sql.indexOf("function public.plan_has_feature"));
    for (const id of ["starter", "mission"] as const) {
      const block = body.slice(body.indexOf(`when '${id}' then case`));
      for (const resource of Object.keys(PLANS[id].limits) as (keyof PlanLimits)[]) {
        const match = block.match(new RegExp(`when '${resource}'\\s+then (\\d+)`));
        expect(match, `${id}.${resource} in plan_limit()`).not.toBeNull();
        expect(Number(match![1]), `${id}.${resource}`).toBe(PLANS[id].limits[resource]);
      }
    }
  });
});
