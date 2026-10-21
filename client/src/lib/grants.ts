/**
 * Grant readiness (migration 025): choices, periods, and the plain-language
 * sentences shown under Impact numbers and in grant packets.
 */

import { formatCount, formatCurrency, formatHours, toISODate } from "@/lib/report-utils";

export const GRANT_STATUSES = [
  { value: "researching", label: "Researching" },
  { value: "writing", label: "Writing" },
  { value: "submitted", label: "Submitted" },
  { value: "awarded", label: "Awarded" },
  { value: "declined", label: "Declined" },
  { value: "reporting", label: "Reporting" },
  { value: "closed", label: "Closed" },
] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number]["value"];

export const NARRATIVE_CATEGORIES = [
  "Mission",
  "Need statement",
  "Program description",
  "Goals and objectives",
  "Evaluation plan",
  "Organizational history",
  "Budget narrative",
  "Sustainability",
  "Other",
];

export const SOP_CATEGORIES = ["General", "Intake", "Distribution", "Volunteers", "Safety", "Finance", "Facilities", "Data and privacy"];

/** Shared with the Volunteer Hours page, so a rate entered in either place is used in both. */
export const VOLUNTEER_RATE_KEY = "volunteer-hour-value";

export type PeriodPreset = "this_year" | "last_year" | "last_12_months" | "all" | "custom";

export const PERIOD_PRESETS: { value: PeriodPreset; label: string }[] = [
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
  { value: "last_12_months", label: "Last 12 months" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom dates" },
];

/** A preset's dates (from null = no start). Custom keeps the dates given. */
export function periodDates(preset: PeriodPreset, custom: { from: string; to: string }, today = new Date()): { from: string | null; to: string } {
  const y = today.getFullYear();
  const iso = toISODate(today);
  switch (preset) {
    case "this_year":
      return { from: `${y}-01-01`, to: iso };
    case "last_year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "last_12_months": {
      const start = new Date(today);
      start.setFullYear(y - 1);
      start.setDate(start.getDate() + 1);
      return { from: toISODate(start), to: iso };
    }
    case "all":
      return { from: null, to: iso };
    default:
      return { from: custom.from || null, to: custom.to || iso };
  }
}

/** Words and characters, as grant portals count them. */
export function textCounts(text: string): { words: number; characters: number } {
  const trimmed = text.trim();
  return { words: trimmed ? trimmed.split(/\s+/).length : 0, characters: text.length };
}

export interface GrantTotals {
  raised: number;
  gifts: number;
  donors: number;
  hours: number;
  volunteers: number;
  sessions: number;
  responses: number;
  people_served: number;
  services_count: number;
  people_helped: number;
  services_value: number;
}

export interface GrantNumbers {
  from: string | null;
  to: string;
  totals: GrantTotals;
  previous: GrantTotals | null;
  new_people: number;
  outcomes: { label: string; form_title: string; measured: number; improved: number; same: number; worse: number }[];
}

const num = (v: unknown) => Number(v) || 0;

/** Numbers come back from Postgres as strings sometimes. */
export function normalizeNumbers(raw: GrantNumbers): GrantNumbers {
  const t = (x: GrantTotals | null): GrantTotals | null =>
    x ? (Object.fromEntries(Object.entries(x).map(([k, v]) => [k, num(v)])) as unknown as GrantTotals) : null;
  return {
    ...raw,
    totals: t(raw.totals)!,
    previous: t(raw.previous),
    new_people: num(raw.new_people),
    outcomes: (raw.outcomes ?? []).map((o) => ({ ...o, measured: num(o.measured), improved: num(o.improved), same: num(o.same), worse: num(o.worse) })),
  };
}

export interface Figure {
  key: string;
  label: string;
  value: string;
  /** A sentence ready to paste into an application. */
  sentence: string;
}

/**
 * The figures shown under Impact numbers and in packets. Zero figures are
 * left out, so applications never say "we served 0 people".
 * periodText is e.g. "In 2026" or "From January 1, 2026 to June 30, 2026".
 */
export function buildFigures(numbers: GrantNumbers, periodText: string, hourlyRate: number | null): Figure[] {
  const t = numbers.totals;
  const out: Figure[] = [];
  const add = (key: string, label: string, value: string, sentence: string, show: boolean) => {
    if (show) out.push({ key, label, value, sentence });
  };
  add("people_served", "People served", formatCount(t.people_served), `${periodText}, we served ${formatCount(t.people_served)} people.`, t.people_served > 0);
  add("new_people", "New people", formatCount(numbers.new_people), `${periodText}, ${formatCount(numbers.new_people)} people came to us for the first time.`, numbers.new_people > 0);
  add("help_given", "Times help was given", formatCount(t.services_count), `${periodText}, we provided help ${formatCount(t.services_count)} times to ${formatCount(t.people_helped)} people.`, t.services_count > 0);
  add("help_value", "Value of help given", formatCurrency(t.services_value), `${periodText}, the help we gave was worth ${formatCurrency(t.services_value)}.`, t.services_value > 0);
  for (const o of numbers.outcomes) {
    const pct = o.measured ? Math.round((o.improved / o.measured) * 100) : 0;
    add(
      `outcome:${o.form_title}:${o.label}`,
      `Improved: ${o.label}`,
      `${pct}%`,
      `${periodText}, ${pct}% of participants we measured more than once (${formatCount(o.improved)} of ${formatCount(o.measured)}) improved on "${o.label}".`,
      o.measured > 0,
    );
  }
  add("hours", "Volunteer hours", formatHours(t.hours), `${periodText}, ${formatCount(t.volunteers)} volunteers gave ${formatHours(t.hours)} hours of service.`, t.hours > 0);
  if (hourlyRate && t.hours > 0) {
    const value = t.hours * hourlyRate;
    add("volunteer_value", "Value of volunteer time", formatCurrency(value), `${periodText}, volunteer time was worth ${formatCurrency(value)} (at ${formatCurrency(hourlyRate)} an hour).`, true);
  }
  add("raised", "Donations raised", formatCurrency(t.raised), `${periodText}, ${formatCount(t.donors)} donors gave ${formatCurrency(t.raised)} in ${formatCount(t.gifts)} gifts.`, t.raised > 0);
  add("responses", "Form responses", formatCount(t.responses), `${periodText}, we collected ${formatCount(t.responses)} form responses.`, t.responses > 0);
  return out;
}
