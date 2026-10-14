/**
 * Helpers shared by the Reports page and its pieces (components/reports/*):
 * dates and periods, grouping, form answers, and CSV/HTML escaping.
 *
 * All report dates are compared as local "YYYY-MM-DD" strings. Parsing
 * "YYYY-MM-DD" with new Date() gives UTC midnight, which puts dates a day
 * early in US time zones.
 */

import type { FormField, FormSubmission } from "@/types/database";
import { isPrivateFileRef, PRIVATE_FILE_TEXT } from "@/lib/uploads";

// ===========================================================================
// Types
// ===========================================================================

export interface DonationRow {
  id: string;
  donor_name: string;
  /** Postgres numeric can arrive as a string; always wrap in Number(). */
  amount: number | string;
  /** "YYYY-MM-DD" */
  date: string;
  campaign: string | null;
  payment_method: string | null;
  notes: string | null;
}

export interface VolunteerHourRow {
  id: string;
  volunteer_name: string;
  activity: string | null;
  hours: number | string;
  /** "YYYY-MM-DD" */
  date: string;
  notes: string | null;
}

export interface InventoryRow {
  id: string;
  name: string;
  category: string | null;
  quantity: number | string;
  unit: string | null;
  condition: string | null;
  location: string | null;
  low_stock_threshold?: number | null;
}

export type PeriodPreset = "all" | "this_month" | "last_30" | "this_year" | "last_year" | "custom";
export type Granularity = "day" | "week" | "month";

/** One point on a time-series chart. */
export interface SeriesPoint {
  key: string;
  label: string;
  value: number;
}

/** One slice of a donut chart or one row of a breakdown. */
export interface NamedValue {
  name: string;
  value: number;
}

// ===========================================================================
// Dates and periods
// ===========================================================================

/** Date -> "YYYY-MM-DD" in local time. */
export const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "YYYY-MM-DD" -> local Date at midnight. */
export const parseLocalDate = (iso: string): Date => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

const addDays = (iso: string, days: number): string => {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
};

/** Days between two "YYYY-MM-DD" dates, counting both ends. */
export const daysInRange = (from: string, to: string): number =>
  Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86400000) + 1;

/** "2026-10-01" -> "Oct 1, 2026" */
export const formatDate = (iso: string): string =>
  iso ? parseLocalDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

/** A submission's timestamp as a local "YYYY-MM-DD", or "" if missing. */
export const submittedDate = (s: Pick<FormSubmission, "submitted_at">): string =>
  s.submitted_at ? toISODate(new Date(s.submitted_at)) : "";

/** Local midnight at the start of a "YYYY-MM-DD", as an ISO timestamp for timestamptz columns. */
export const startOfDayTimestamp = (iso: string): string => parseLocalDate(iso).toISOString();

/** Local midnight after a "YYYY-MM-DD" (exclusive end), as an ISO timestamp. */
export const endOfDayTimestamp = (iso: string): string => parseLocalDate(addDays(iso, 1)).toISOString();

/** True if the "YYYY-MM-DD" date is inside the (inclusive) range. Empty bounds are open. */
export const inRange = (iso: string, from: string, to: string): boolean => {
  if (!iso) return !from && !to;
  const day = iso.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
};

/** Start and end dates for a period preset. Worked out when called, so it never goes stale. */
export const getPresetRange = (preset: PeriodPreset): { from: string; to: string } => {
  const today = new Date();
  const y = today.getFullYear();
  switch (preset) {
    case "this_month":
      return { from: toISODate(new Date(y, today.getMonth(), 1)), to: toISODate(today) };
    case "last_30":
      return { from: addDays(toISODate(today), -29), to: toISODate(today) };
    case "this_year":
      return { from: toISODate(new Date(y, 0, 1)), to: toISODate(today) };
    case "last_year":
      return { from: toISODate(new Date(y - 1, 0, 1)), to: toISODate(new Date(y - 1, 11, 31)) };
    default:
      return { from: "", to: "" };
  }
};

/**
 * The period to compare against, or null for "All time" and open-ended ranges.
 *   This month -> the same days of last month (Oct 1-14 vs Sep 1-14)
 *   This year / Last year -> the same dates one year earlier
 *   Anything else -> the same number of days just before
 */
export const getPreviousRange = (preset: PeriodPreset, from: string, to: string): { from: string; to: string } | null => {
  if (!from || !to || from > to) return null;
  const shift = (iso: string, months: number) => {
    const d = parseLocalDate(iso);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + months);
    // Clamp Mar 31 -> Feb 28/29 instead of rolling into March.
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return toISODate(d);
  };
  if (preset === "this_month") return { from: shift(from, -1), to: shift(to, -1) };
  if (preset === "this_year" || preset === "last_year") return { from: shift(from, -12), to: shift(to, -12) };
  const length = daysInRange(from, to);
  return { from: addDays(from, -length), to: addDays(from, -1) };
};

/** Human-readable description of a period, for headers and exports. */
export const describePeriod = (from: string, to: string): string => {
  if (!from && !to) return "All time";
  if (from && to) return `${formatDate(from)} to ${formatDate(to)}`;
  return from ? `From ${formatDate(from)}` : `Through ${formatDate(to)}`;
};

/** Days for short spans, weeks up to about six months, months beyond. */
export const pickGranularity = (from: string, to: string): Granularity => {
  if (!from || !to) return "month";
  const days = daysInRange(from, to);
  return days <= 45 ? "day" : days <= 190 ? "week" : "month";
};

/** The Monday on or before a date, as "YYYY-MM-DD". */
const weekStart = (iso: string): string => {
  const d = parseLocalDate(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISODate(d);
};

const bucketKey = (iso: string, g: Granularity): string =>
  g === "month" ? iso.slice(0, 7) : g === "week" ? weekStart(iso) : iso.slice(0, 10);

/**
 * Turn dated values into a continuous series, summed per day, week or month.
 * The series covers the whole period when one is given (so "This month"
 * shows every day, not just days with activity), and missing buckets are 0
 * so lines never slope across a gap.
 */
export const buildTimeSeries = (
  entries: { date: string; value: number }[],
  granularity: Granularity,
  range?: { from: string; to: string },
): SeriesPoint[] => {
  const valid = entries.filter((e) => /^\d{4}-\d{2}-\d{2}/.test(e.date));
  const totals = new Map<string, number>();
  for (const e of valid) {
    const k = bucketKey(e.date, granularity);
    totals.set(k, (totals.get(k) ?? 0) + e.value);
  }

  const dataKeys = Array.from(totals.keys()).sort();
  const firstKey = range?.from ? bucketKey(range.from, granularity) : dataKeys[0];
  const lastKey = range?.to ? bucketKey(range.to, granularity) : dataKeys[dataKeys.length - 1];
  if (!firstKey || !lastKey) return [];

  const cursor = parseLocalDate(granularity === "month" ? `${firstKey}-01` : firstKey);
  const points: SeriesPoint[] = [];
  // The cap guards against a bad date (e.g. year 1900) producing a huge loop.
  for (let i = 0; i < 2000; i++) {
    const key = bucketKey(toISODate(cursor), granularity);
    points.push({
      key,
      label:
        granularity === "month"
          ? cursor.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
          : cursor.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: Math.round((totals.get(key) ?? 0) * 100) / 100,
    });
    if (key >= lastKey) break;
    if (granularity === "month") cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + (granularity === "week" ? 7 : 1));
  }
  return points;
};

export const granularityLabel = (g: Granularity): string => (g === "day" ? "day" : g === "week" ? "week" : "month");

// ===========================================================================
// Numbers and grouping
// ===========================================================================

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
export const formatCurrency = (n: number): string => currencyFormatter.format(n);

/** Hours rounded to one decimal; avoids floating point noise like 10.299999. */
export const formatHours = (n: number): string => (Math.round(n * 10) / 10).toLocaleString("en-US");

export const formatCount = (n: number): string => n.toLocaleString("en-US");

/** Fractional change from previous to current, or null when there's nothing to compare. */
export const percentChange = (current: number, previous: number | null | undefined): number | null => {
  if (previous == null) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
};

/** "+18%" / "-4%" / "no change" */
export const formatChange = (change: number): string => {
  const pct = Math.round(change * 100);
  return pct === 0 ? "no change" : `${pct > 0 ? "+" : ""}${pct}%`;
};

/** Sum values by a key, returned largest first. */
export const sumBy = <T,>(rows: T[], keyFn: (row: T) => string, valueFn: (row: T) => number): NamedValue[] => {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const k = keyFn(row);
    totals.set(k, (totals.get(k) ?? 0) + valueFn(row));
  }
  return Array.from(totals, ([name, value]) => ({ name, value: Math.round(value * 100) / 100 })).sort(
    (a, b) => b.value - a.value,
  );
};

/** Lowercase, trimmed name so "Jane Smith" and "jane smith " count as one person. */
export const normalizeName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Shorten a label for a chart axis; the tooltip shows the full text. */
export const shorten = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}...` : text);

// ===========================================================================
// Inventory (same rules as the Inventory page)
// ===========================================================================

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const getQty = (i: InventoryRow): number => Number(i.quantity) || 0;
export const getThreshold = (i: InventoryRow): number => i.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
export const isOutOfStock = (i: InventoryRow): boolean => getQty(i) <= 0;
/** Above zero but at or below the item's own threshold. */
export const isLowStock = (i: InventoryRow): boolean => getQty(i) > 0 && getQty(i) <= getThreshold(i);
export const needsRestock = (i: InventoryRow): boolean => isLowStock(i) || isOutOfStock(i);

// ===========================================================================
// Form answers
// ===========================================================================

/** Field types summarized as a chart of answer counts. */
export const CHOICE_FIELD_TYPES = new Set(["select", "radio", "checkbox", "multiselect"]);
export const TEXT_FIELD_TYPES = new Set(["text", "textarea", "email", "phone"]);
export const MEDIA_FIELD_TYPES = new Set(["image", "audio", "file"]);

/** Fields that collect answers (section headings don't). */
export const answerFields = (fields: FormField[] | null | undefined): FormField[] =>
  (fields ?? []).filter((f) => f.type !== "section");

/** Raw answer for a field from a submission. */
export const getAnswer = (s: FormSubmission, fieldId: string): unknown =>
  (s.data as Record<string, unknown> | null)?.[fieldId];

export const isBlank = (v: unknown): boolean => v === undefined || v === null || v === "";

/**
 * An uploaded file for photo, voice memo and file fields: a private file
 * reference (lib/uploads.ts) or an older public link. Show it with the
 * components in components/uploaded-file.tsx, which open private files.
 */
export const mediaUrl = (field: FormField, value: unknown): string | null =>
  MEDIA_FIELD_TYPES.has(field.type) && typeof value === "string" && (/^https:\/\//.test(value) || isPrivateFileRef(value)) ? value : null;

/** Display text for any answer value. Checkbox booleans become Yes/No and lists are joined. */
export const formatAnswer = (value: unknown): string => {
  if (isBlank(value)) return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(formatAnswer).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  // Private files only open inside HumMotion, so exports say so instead of a link.
  if (isPrivateFileRef(value)) return PRIVATE_FILE_TEXT;
  return String(value);
};

/** Text for exports: media answers become their link. */
export const answerText = (field: FormField, s: FormSubmission): string => formatAnswer(getAnswer(s, field.id));

/** Count answers for a choice field. Multi-select arrays count each option. */
export const summarizeChoices = (field: FormField, subs: FormSubmission[]): NamedValue[] => {
  const counts = new Map<string, number>();
  for (const s of subs) {
    const raw = getAnswer(s, field.id);
    if (isBlank(raw)) continue;
    for (const v of Array.isArray(raw) ? raw : [raw]) {
      const k = formatAnswer(v);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
};

/** Average, min, max and total for a number field. A loop, since Math.min(...big) overflows the stack. */
export const summarizeNumbers = (field: FormField, subs: FormSubmission[]) => {
  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const s of subs) {
    const raw = getAnswer(s, field.id);
    if (isBlank(raw)) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    count++;
    sum += n;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  if (!count) return null;
  return { count, avg: sum / count, min, max, sum };
};

/** How many submissions answered a field. */
export const answeredCount = (field: FormField, subs: FormSubmission[]): number =>
  subs.reduce((n, s) => (isBlank(getAnswer(s, field.id)) ? n : n + 1), 0);

// ===========================================================================
// Loading and exporting
// ===========================================================================

/** Supabase returns at most 1000 rows per request by default. */
const PAGE_SIZE = 1000;

/** Fetch every row of a query, one page at a time, so totals are never silently capped. */
export async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Escape text for HTML. Every value written into the PDF page goes through
 * this: form answers come from the public, and unescaped they could run
 * scripts in a window that shares the app's sign-in.
 */
export const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Escape a CSV cell: doubles embedded quotes and neutralizes text starting
 * with = + - @ so spreadsheets don't run it as a formula.
 */
const csvCell = (value: unknown): string => {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

/** Build and download a CSV file. Adds a BOM so Excel reads accented names correctly. */
export const downloadCsv = (filename: string, rows: unknown[][]) => {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** "Riverside Food Bank" + "donations" -> "riverside-food-bank-donations-report-2026-10-14.csv" */
export const exportFileName = (parts: string[], ext: string): string =>
  `${parts.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-report-${toISODate(new Date())}.${ext}`;
