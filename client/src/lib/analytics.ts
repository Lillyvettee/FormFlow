/**
 * Analytics (migration 024): types for get_analytics() and the buying-plan
 * math, kept here so it can be tested.
 *
 * Buying plan, per item:
 *   average daily use  = units used in the last 90 days / days of history
 *                        (fewer than 90 for new items or recent tracking)
 *   days left          = in stock / average daily use
 *   suggested to buy   = target level - in stock, when a target is set;
 *                        otherwise enough for the chosen weeks of use,
 *                        minus what's in stock. Never below zero.
 */

export interface AnalyticsItem {
  id: string;
  name: string;
  unit: string | null;
  category: string | null;
  quantity: number;
  target_quantity: number | null;
  used_30: number;
  used_90: number;
  received_90: number;
  history_days: number;
  last_used: string | null;
}

export interface Analytics {
  generated_at: string;
  inventory: {
    items: AnalyticsItem[];
    weekly_usage: { week: string; used: number }[];
    tracking_since: string | null;
  };
  demand: {
    by_month: { month: string; people: number; new_people: number; help_given: number }[];
    by_weekday: { weekday: number; visits: number; help_given: number }[];
    people_90: number;
    people_prev_90: number;
    new_90: number;
  };
  fundraising: {
    by_month: { month: number; this_year: number; last_year: number }[];
    ytd: number;
    last_ytd: number;
    last_year_total: number;
    gifts_ytd: number;
    donors_ytd: number;
    donors_last_year: number;
    retained_donors: number;
    day_of_year: number;
    days_in_year: number;
  };
  volunteers: {
    by_weekday: { weekday: number; hours: number }[];
    by_month: { month: string; hours: number }[];
  };
}

export type BuyStatus = "out" | "this_week" | "buy" | "ok" | "no_usage";

export interface ItemPlan {
  item: AnalyticsItem;
  dailyUse: number;
  weeklyUse: number;
  daysLeft: number | null;
  runsOut: Date | null;
  suggested: number;
  basis: "target" | "weeks";
  status: BuyStatus;
}

/** ISO weekday (1 = Monday) to a short name. */
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Numbers come back from Postgres as strings sometimes; make them numbers. */
export const n = (v: unknown): number => Number(v) || 0;

export function planItem(raw: AnalyticsItem, weeks: number, today = new Date()): ItemPlan {
  const item = { ...raw, quantity: n(raw.quantity), used_90: n(raw.used_90), history_days: Math.max(1, n(raw.history_days)) };
  const target = raw.target_quantity == null ? null : n(raw.target_quantity);
  const dailyUse = Math.max(0, item.used_90) / item.history_days;
  const daysLeft = dailyUse > 0 ? item.quantity / dailyUse : null;
  const runsOut = daysLeft === null ? null : new Date(today.getTime() + daysLeft * 86_400_000);

  const suggested =
    target !== null
      ? Math.max(0, target - item.quantity)
      : dailyUse > 0
        ? Math.max(0, Math.ceil(dailyUse * 7 * weeks - item.quantity))
        : 0;

  let status: BuyStatus;
  if (item.quantity <= 0 && (dailyUse > 0 || target !== null)) status = "out";
  else if (daysLeft !== null && daysLeft < 7) status = "this_week";
  else if (suggested > 0) status = "buy";
  else if (dailyUse === 0 && target === null) status = "no_usage";
  else status = "ok";

  return { item, dailyUse, weeklyUse: dailyUse * 7, daysLeft, runsOut, suggested, basis: target !== null ? "target" : "weeks", status };
}

/** Most urgent first: out of stock, then soonest to run out, then biggest suggested buy. */
const STATUS_ORDER: Record<BuyStatus, number> = { out: 0, this_week: 1, buy: 2, ok: 3, no_usage: 4 };
export function sortPlans(plans: ItemPlan[]): ItemPlan[] {
  return [...plans].sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity) ||
      b.suggested - a.suggested ||
      a.item.name.localeCompare(b.item.name),
  );
}

/** Percent change, or null when there's nothing to compare with. */
export function change(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 100) : null;
}

/** Straight-line year-end projection from the year so far. */
export function projectYearEnd(ytd: number, dayOfYear: number, daysInYear: number): number | null {
  return dayOfYear >= 14 && ytd > 0 ? (ytd / dayOfYear) * daysInYear : null;
}

// ---------------------------------------------------------------------------
// How much data each section needs
// ---------------------------------------------------------------------------

/** Days of stock history before the buying plan's estimates are reliable. */
export const STOCK_DAYS_NEEDED = 28;
/** Months with visits before demand trends mean much. */
export const DEMAND_MONTHS_NEEDED = 2;

export type AnalyticsSection = "inventory" | "demand" | "fundraising" | "volunteers";

export interface SectionReadiness {
  section: AnalyticsSection;
  ready: boolean;
  /** What's needed, in plain words. */
  message: string;
  /** How far along, 0 to 1, when it fills up over time. */
  progress?: number;
}

/** Which sections have enough data yet, and what the rest still need. */
export function dataReadiness(data: Analytics, today = new Date()): SectionReadiness[] {
  const since = data.inventory.tracking_since ? new Date(data.inventory.tracking_since) : null;
  const stockDays = since ? Math.max(0, Math.floor((today.getTime() - since.getTime()) / 86_400_000)) : 0;
  const demandMonths = data.demand.by_month.filter((m) => n(m.people) > 0).length;
  const volunteerHours = data.volunteers.by_weekday.reduce((s, d) => s + n(d.hours), 0);

  return [
    {
      section: "inventory",
      ready: stockDays >= STOCK_DAYS_NEEDED,
      message: since
        ? `The buying plan needs ${STOCK_DAYS_NEEDED} days of stock history to estimate use reliably: ${Math.min(stockDays, STOCK_DAYS_NEEDED)} of ${STOCK_DAYS_NEEDED} days so far. Until then, suggestions are early estimates.`
        : `The buying plan starts once items are given out or restocked. It needs ${STOCK_DAYS_NEEDED} days of stock history to estimate use reliably.`,
      progress: Math.min(1, stockDays / STOCK_DAYS_NEEDED),
    },
    {
      section: "demand",
      ready: demandMonths >= DEMAND_MONTHS_NEEDED,
      message: `Demand trends need visits in at least ${DEMAND_MONTHS_NEEDED} months (help given or form responses linked to people): ${Math.min(demandMonths, DEMAND_MONTHS_NEEDED)} so far.`,
      progress: Math.min(1, demandMonths / DEMAND_MONTHS_NEEDED),
    },
    {
      section: "fundraising",
      ready: n(data.fundraising.last_year_total) > 0,
      message: "Comparisons with last year appear once there are donations recorded for last year.",
    },
    {
      section: "volunteers",
      ready: volunteerHours > 0,
      message: "Volunteer coverage needs volunteer hours logged in the last 90 days.",
    },
  ];
}
