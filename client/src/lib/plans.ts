/**
 * Plans and pricing
 *
 * The one place the app keeps prices, limits and features. The landing page,
 * Settings > Plan and the limit checks all read from here.
 *
 * Keep in step with:
 *   - the Stripe prices (BILLING_SETUP.md, step 2)
 *   - plan_limit() and plan_has_feature() in supabase/migrations/016_plans_and_limits.sql,
 *     which is what actually enforces the limits
 *   - the prices on the Terms and Refund policy pages
 */

export type PlanId = "starter" | "mission" | "enterprise";
/** Plans sold through Stripe Checkout. Enterprise is arranged with sales. */
export type PaidPlan = "starter" | "mission";
export type BillingCycle = "monthly" | "yearly";

/** null means unlimited. */
export interface PlanLimits {
  forms: number | null;
  members: number | null;
  people: number | null;
  /** PDF reports per calendar month. */
  reports: number | null;
}

export interface PlanFeatures {
  importExport: boolean;
  branding: boolean;
}

export interface PlanInfo {
  id: PlanId;
  name: string;
  tagline: string;
  /** Whole dollars. null for Enterprise (contact us). */
  monthlyPrice: number | null;
  /** Whole dollars per year: 20% off twelve months, rounded down. */
  yearlyPrice: number | null;
  limits: PlanLimits;
  features: PlanFeatures;
  /** Bullet points for pricing cards. */
  highlights: string[];
}

/** Yearly billing saves this much. */
export const YEARLY_DISCOUNT_PERCENT = 20;

export const PLANS: Record<PlanId, PlanInfo> = {
  starter: {
    id: "starter",
    name: "Starter",
    tagline: "For small teams getting organized",
    monthlyPrice: 49,
    yearlyPrice: 470,
    limits: { forms: 50, members: 2, people: 200, reports: 50 },
    features: { importExport: false, branding: false },
    highlights: [
      "50 active forms",
      "2 team members",
      "200 client profiles",
      "Impact tracking",
      "50 PDF reports a month",
    ],
  },
  mission: {
    id: "mission",
    name: "Mission",
    tagline: "For growing non-profits",
    monthlyPrice: 199,
    yearlyPrice: 1910,
    limits: { forms: 100, members: 10, people: 500, reports: 100 },
    features: { importExport: true, branding: true },
    highlights: [
      "100 active forms",
      "10 team members",
      "500 client profiles",
      "Impact tracking",
      "100 PDF reports a month",
      "CSV and Excel import and export",
      "Custom branding",
    ],
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    tagline: "For large and multi-site organizations",
    monthlyPrice: null,
    yearlyPrice: null,
    limits: { forms: null, members: null, people: null, reports: null },
    features: { importExport: true, branding: true },
    highlights: [
      "Everything in Mission",
      "Unlimited forms",
      "Unlimited team members",
      "Unlimited client profiles",
      "Unlimited PDF reports",
      "Priority support",
      "Onboarding and data migration help",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["starter", "mission", "enterprise"];

/** Where Enterprise "Contact us" buttons go. */
export const ENTERPRISE_CONTACT_PATH = "/enterprise";

/** Shown per month: the monthly price, or the yearly price spread over 12 months (rounded). */
export function monthlyEquivalent(plan: PlanInfo, cycle: BillingCycle): number | null {
  if (plan.monthlyPrice === null || plan.yearlyPrice === null) return null;
  return cycle === "monthly" ? plan.monthlyPrice : Math.round(plan.yearlyPrice / 12);
}

/** e.g. "Billed monthly" or "Billed $470/year". */
export function billingLabel(plan: PlanInfo, cycle: BillingCycle): string {
  if (plan.yearlyPrice === null) return "Custom pricing";
  return cycle === "monthly" ? "Billed monthly" : `Billed ${formatDollars(plan.yearlyPrice)}/year`;
}

export function formatDollars(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

/** "Unlimited" or the number with separators. */
export function formatLimit(limit: number | null): string {
  return limit === null ? "Unlimited" : limit.toLocaleString("en-US");
}

/** Shown where a Starter organization reaches for import or export. */
export const IMPORT_EXPORT_UPGRADE_MESSAGE =
  "Import and export are included with the Mission and Enterprise plans. Upgrade in Settings > Plan.";
