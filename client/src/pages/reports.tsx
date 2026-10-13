/**
 * ReportsPage
 *
 * Read-only reports built from the user's donations, volunteer hours,
 * inventory and form submissions, for boards, donors and grant applications.
 *
 * Report tabs:
 *   - Impact overview      headline numbers across everything
 *   - Donation report      totals, trends, campaigns, payment methods
 *   - Volunteer report     hours, top volunteers, activities
 *   - Inventory report     current stock, categories, restock list
 *   - Form submissions     per-form charts, statistics and a searchable table
 *
 * A shared "Report period" filter (All time, This month, This year, custom
 * dates, ...) applies to donations, volunteer hours and form submissions.
 * Inventory is always a snapshot of current stock, so the period does not
 * apply to it.
 *
 * Exports:
 *   - CSV: the data behind the current tab, for the current period
 *   - PDF: opens a print-ready page in a new tab and starts the print dialog
 *     (choose "Save as PDF" as the printer)
 *
 * Backend assumptions:
 *   - Tables: forms, donations, volunteer_hours, inventory_items, form_submissions.
 *   - Row Level Security restricts rows to their owner.
 */

import { useState, useEffect, useMemo, useId, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Download,
  FileText,
  FileDown,
  DollarSign,
  Clock,
  Package,
  TrendingUp,
  AlertTriangle,
  Search,
  X,
  CalendarRange,
  type LucideIcon,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  LineChart,
  Line,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { Form, FormField, FormSubmission } from "@/types/database";

// ===========================================================================
// Row types
// The original used `any[]` for donations, hours and inventory, so typos in
// column names compiled without warning. These describe the columns used here.
// ===========================================================================

interface DonationRow {
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

interface VolunteerHourRow {
  id: string;
  volunteer_name: string;
  activity: string | null;
  hours: number | string;
  /** "YYYY-MM-DD" */
  date: string;
  notes: string | null;
}

interface InventoryRow {
  id: string;
  name: string;
  category: string | null;
  quantity: number | string;
  unit: string | null;
  condition: string | null;
  location: string | null;
  low_stock_threshold?: number | null;
}

type ReportType = "impact" | "donations" | "volunteers" | "inventory" | "forms";
type PeriodPreset = "all" | "this_month" | "last_30" | "this_year" | "last_year" | "custom";

/** One point on a time-series chart. */
interface SeriesPoint {
  key: string;
  label: string;
  value: number;
}

/** One slice of a donut chart or one row of a breakdown. */
interface NamedValue {
  name: string;
  value: number;
}

// ===========================================================================
// Constants
// ===========================================================================

/**
 * Palette for multi-series charts (donut slices, etc.). Fixed colors are used
 * here because a chart with many slices needs more distinct colors than the
 * theme provides.
 */
const COLORS = [
  "hsl(217, 91%, 35%)",
  "hsl(195, 80%, 32%)",
  "hsl(150, 58%, 30%)",
  "hsl(340, 70%, 45%)",
  "hsl(40, 85%, 40%)",
  "hsl(270, 60%, 40%)",
];

const REPORT_TYPES: { value: ReportType; label: string; icon: LucideIcon }[] = [
  { value: "impact", label: "Impact Overview", icon: TrendingUp },
  { value: "donations", label: "Donation Report", icon: DollarSign },
  { value: "volunteers", label: "Volunteer Hours Report", icon: Clock },
  { value: "inventory", label: "Inventory Report", icon: Package },
  { value: "forms", label: "Form Submissions Report", icon: FileText },
];

const PERIOD_PRESETS: { value: Exclude<PeriodPreset, "custom">; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "this_month", label: "This month" },
  { value: "last_30", label: "Last 30 days" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
];

/** Field types summarized as a donut chart of answer counts. */
const CHOICE_FIELD_TYPES = ["select", "radio", "checkbox"];

/** Default threshold, matching the Inventory page. */
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** Supabase returns at most 1000 rows per request by default. */
const PAGE_SIZE = 1000;

/** Tables show at most this many rows on screen; exports always include everything. */
const MAX_TABLE_ROWS = 200;

/** "All forms" option in the form picker. Radix Select cannot use "" as an item value. */
const ALL_FORMS = "__all__";

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };

const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  color: "hsl(var(--foreground))",
};

// ===========================================================================
// Date helpers
// All report dates are compared as local "YYYY-MM-DD" strings. The original
// parsed dates with new Date("YYYY-MM-DD"), which is UTC midnight, so date
// filters were off by one day in US time zones.
// ===========================================================================

/** Date -> "YYYY-MM-DD" in local time. */
const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** "YYYY-MM-DD" -> local Date at midnight. */
const parseLocalDate = (iso: string): Date => {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};

/** "2026-10-01" -> "Oct 1, 2026" */
const formatDate = (iso: string): string =>
  iso ? parseLocalDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

/** A submission's timestamp as a local "YYYY-MM-DD", or "" if missing. */
const submittedDate = (s: FormSubmission): string => (s.submitted_at ? toISODate(new Date(s.submitted_at)) : "");

/** True if the "YYYY-MM-DD" date is inside the (inclusive) range. Empty bounds are open. */
const inRange = (iso: string, from: string, to: string): boolean => {
  if (!iso) return !from && !to;
  const day = iso.slice(0, 10);
  return (!from || day >= from) && (!to || day <= to);
};

/** Start and end dates for a period preset. */
const getPresetRange = (preset: PeriodPreset): { from: string; to: string } => {
  const today = new Date();
  const y = today.getFullYear();
  switch (preset) {
    case "this_month":
      return { from: toISODate(new Date(y, today.getMonth(), 1)), to: toISODate(today) };
    case "last_30": {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { from: toISODate(start), to: toISODate(today) };
    }
    case "this_year":
      return { from: toISODate(new Date(y, 0, 1)), to: toISODate(today) };
    case "last_year":
      return { from: toISODate(new Date(y - 1, 0, 1)), to: toISODate(new Date(y - 1, 11, 31)) };
    default:
      return { from: "", to: "" };
  }
};

/** Human-readable description of the selected period, for headers and exports. */
const describePeriod = (from: string, to: string): string => {
  if (!from && !to) return "All time";
  if (from && to) return `${formatDate(from)} to ${formatDate(to)}`;
  return from ? `From ${formatDate(from)}` : `Through ${formatDate(to)}`;
};

/**
 * Turn dated values into a continuous time series, summing values per day
 * or per month.
 *
 * Fixes over the original:
 * - Keys are sortable ("2026-10" / "2026-10-12") instead of display strings,
 *   so points are always in date order. The submissions chart was drawn
 *   backwards in time because submissions were loaded newest first.
 * - Daily keys include the year, so Oct 12 of two different years no longer
 *   merge into one point.
 * - Missing days/months are filled with 0. Without this, a line or area chart
 *   draws a straight slope across a gap, implying activity that never happened.
 */
const buildTimeSeries = (entries: { date: string; value: number }[], granularity: "day" | "month"): SeriesPoint[] => {
  const valid = entries.filter((e) => /^\d{4}-\d{2}-\d{2}/.test(e.date));
  if (!valid.length) return [];

  const keyOf = (iso: string) => (granularity === "month" ? iso.slice(0, 7) : iso.slice(0, 10));
  const totals = new Map<string, number>();
  for (const e of valid) {
    const k = keyOf(e.date);
    totals.set(k, (totals.get(k) ?? 0) + e.value);
  }

  const keys = Array.from(totals.keys()).sort();
  const cursor = parseLocalDate(granularity === "month" ? `${keys[0]}-01` : keys[0]);
  const lastKey = keys[keys.length - 1];
  const points: SeriesPoint[] = [];

  // The cap guards against a bad date (e.g. year 1900) producing a huge loop.
  for (let i = 0; i < 2000; i++) {
    const iso = toISODate(cursor);
    const key = keyOf(iso);
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
    else cursor.setDate(cursor.getDate() + 1);
  }
  return points;
};

/** Daily points for short spans, monthly for anything over about three months. */
const pickGranularity = (dates: string[]): "day" | "month" => {
  const sorted = dates.filter(Boolean).sort();
  if (sorted.length < 2) return "day";
  const spanDays = (parseLocalDate(sorted[sorted.length - 1]).getTime() - parseLocalDate(sorted[0]).getTime()) / 86400000;
  return spanDays > 92 ? "month" : "day";
};

// ===========================================================================
// Number and grouping helpers
// ===========================================================================

const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const formatCurrency = (n: number): string => currencyFormatter.format(n);

/** Hours rounded to one decimal; avoids floating point noise like 10.299999. */
const formatHours = (n: number): string => (Math.round(n * 10) / 10).toLocaleString("en-US");

/** Sum values by a key, returned largest first. */
const sumBy = <T,>(rows: T[], keyFn: (row: T) => string, valueFn: (row: T) => number): NamedValue[] => {
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
const normalizeName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

/** Shorten a label for a chart axis; the tooltip shows the full text. */
const shorten = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}...` : text);

// ----- Inventory helpers (same rules as the Inventory page) -----

const getQty = (i: InventoryRow): number => Number(i.quantity) || 0;
const getThreshold = (i: InventoryRow): number => i.low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;
const isOutOfStock = (i: InventoryRow): boolean => getQty(i) <= 0;
/**
 * Above zero but at or below the threshold. The original counted empty items
 * as "low stock" too, so the Low Stock and Out of Stock numbers overlapped.
 */
const isLowStock = (i: InventoryRow): boolean => getQty(i) > 0 && getQty(i) <= getThreshold(i);
const needsRestock = (i: InventoryRow): boolean => isLowStock(i) || isOutOfStock(i);

// ----- Form answer helpers -----

/** Raw answer for a field from a submission. */
const getAnswer = (s: FormSubmission, fieldId: string): unknown =>
  (s.data as Record<string, unknown> | null)?.[fieldId];

/**
 * Display text for any answer value. Checkbox booleans become Yes/No (the
 * original showed "true"/"false"), lists are joined, and objects are shown as JSON.
 */
const formatAnswer = (value: unknown): string => {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(formatAnswer).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/** Count answers for a choice field. Multi-select arrays count each option. */
const summarizeChoices = (field: FormField, subs: FormSubmission[]): NamedValue[] => {
  const counts = new Map<string, number>();
  for (const s of subs) {
    const raw = getAnswer(s, field.id);
    if (raw === undefined || raw === null || raw === "") continue;
    for (const v of Array.isArray(raw) ? raw : [raw]) {
      const k = formatAnswer(v);
      if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
};

/**
 * Average, min, max and total for a number field.
 * Uses a loop instead of Math.min(...values), which throws a stack overflow
 * on very large arrays.
 */
const summarizeNumbers = (field: FormField, subs: FormSubmission[]) => {
  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const s of subs) {
    const raw = getAnswer(s, field.id);
    if (raw === undefined || raw === null || raw === "") continue;
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

// ===========================================================================
// Data loading and export helpers
// ===========================================================================

/**
 * Fetch every row of a query, one page at a time.
 *
 * Supabase caps each request at 1000 rows by default. The original fetched
 * once, so an organization with more than 1000 donations or submissions got
 * silently incomplete totals in reports meant for boards and grant funders.
 */
async function fetchAll<T>(
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
 * Escape text for safe insertion into HTML.
 *
 * Security fix: the PDF export built its page by pasting donor names, notes
 * and form answers straight into HTML. Form answers come from the public, so
 * a respondent could submit a <script> or <img onerror> that would run in a
 * window sharing your app's origin, with access to the signed-in session.
 * Every value written into the PDF page now goes through this.
 */
const escapeHtml = (value: unknown): string =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/**
 * Escape a value for a CSV cell: doubles embedded quotes and neutralizes text
 * starting with = + - @ so spreadsheets do not run it as a formula.
 * The original did neither, and left the "Submitted At" column unquoted even
 * though dates like "10/12/2026, 3:05 PM" contain a comma, which shifted
 * every answer one column to the right.
 */
const csvCell = (value: unknown): string => {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

/** Build and download a CSV file. Adds a BOM so Excel reads accented names correctly. */
const downloadCsv = (filename: string, rows: unknown[][]) => {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
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

// ===========================================================================
// Small presentational components
// These replace large blocks of chart markup that were copy-pasted several
// times in the original.
// ===========================================================================

interface StatItem {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Shows the value in red, e.g. for low stock counts above zero. */
  danger?: boolean;
}

/** Grid of headline numbers. */
function StatGrid({ stats }: { stats: StatItem[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {stats.map((s) => {
        const Icon = s.icon;
        return (
          <Card key={s.label} className={`p-5 ${s.danger ? "border-destructive/40" : ""}`}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              {Icon && (
                <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>
              )}
            </div>
            <p className={`text-2xl font-bold ${s.danger ? "text-destructive" : ""}`}>{s.value}</p>
          </Card>
        );
      })}
    </div>
  );
}

/** Card with a heading, used around every chart. */
function ChartCard({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <Card className={`p-6 ${className}`}>
      <h3 className="font-semibold mb-4">{title}</h3>
      {children}
    </Card>
  );
}

/** Placeholder shown when a chart has no data. */
function EmptyChart({ message = "No data for this period" }: { message?: string }) {
  return <p className="text-sm text-muted-foreground text-center py-12">{message}</p>;
}

/**
 * Area, bar or line chart of a time series.
 * Each instance gets a unique gradient id; the original reused ids, which
 * breaks the fill when two area charts are on the page at once.
 */
function TimeSeriesChart({
  data,
  kind,
  color = COLORS[0],
  seriesName,
  valueFormatter = (v) => v.toLocaleString("en-US"),
  yTickFormatter,
  heightClass = "h-52",
}: {
  data: SeriesPoint[];
  kind: "area" | "bar" | "line";
  color?: string;
  seriesName: string;
  valueFormatter?: (v: number) => string;
  yTickFormatter?: (v: number) => string;
  heightClass?: string;
}) {
  // useId returns values with colons, which are not valid inside url(#...).
  const gradientId = `grad-${useId().replace(/:/g, "")}`;
  if (!data.length) return <EmptyChart />;

  const tooltip = (
    <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [valueFormatter(Number(v)), seriesName]} />
  );
  const grid = <CartesianGrid strokeDasharray="3 3" className="stroke-border" />;
  const xAxis = <XAxis dataKey="label" tick={AXIS_TICK} minTickGap={12} />;
  const yAxis = <YAxis tick={AXIS_TICK} tickFormatter={yTickFormatter} width={64} />;

  return (
    <div className={heightClass}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "area" ? (
          <AreaChart data={data}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            <Area type="monotone" dataKey="value" name={seriesName} stroke={color} fill={`url(#${gradientId})`} strokeWidth={2} />
          </AreaChart>
        ) : kind === "bar" ? (
          <BarChart data={data}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            <Bar dataKey="value" name={seriesName} fill={color} radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={data}>
            {grid}
            {xAxis}
            {yAxis}
            {tooltip}
            <Line type="monotone" dataKey="value" name={seriesName} stroke={color} strokeWidth={2} dot={data.length < 40} />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Donut chart with a color legend underneath.
 * The legend lists the top `legendLimit` entries and says how many more there
 * are, instead of silently cutting the list off as before.
 */
function DonutChart({
  data,
  valueFormatter = (v) => v.toLocaleString("en-US"),
  legendLimit = 5,
  heightClass = "h-40",
  showLabels = false,
}: {
  data: NamedValue[];
  valueFormatter?: (v: number) => string;
  legendLimit?: number;
  heightClass?: string;
  showLabels?: boolean;
}) {
  if (!data.length) return <EmptyChart />;
  const total = data.reduce((s, d) => s + d.value, 0);
  const hidden = data.length - legendLimit;

  return (
    <>
      <div className={heightClass}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="50%"
              outerRadius="85%"
              dataKey="value"
              nameKey="name"
              paddingAngle={2}
              label={showLabels ? ({ percent }) => `${Math.round((percent ?? 0) * 100)}%` : undefined}
            >
              {data.map((entry, i) => (
                <Cell key={entry.name} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => [valueFormatter(Number(v)), name]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="space-y-1 mt-3">
        {data.slice(0, legendLimit).map((d, i) => (
          <li key={d.name} className="flex items-center justify-between text-xs gap-2">
            <span className="flex items-center gap-1.5 min-w-0">
              <span
                className="h-2.5 w-2.5 rounded-sm shrink-0"
                style={{ backgroundColor: COLORS[i % COLORS.length] }}
                aria-hidden="true"
              />
              <span className="truncate" title={d.name}>
                {d.name}
              </span>
            </span>
            <span className="font-medium whitespace-nowrap">
              {valueFormatter(d.value)}
              {total > 0 && <span className="text-muted-foreground font-normal"> ({Math.round((d.value / total) * 100)}%)</span>}
            </span>
          </li>
        ))}
        {hidden > 0 && <li className="text-xs text-muted-foreground">and {hidden} more</li>}
      </ul>
    </>
  );
}

// ===========================================================================
// Page component
// ===========================================================================

export default function ReportsPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ----- Raw data -----
  const [forms, setForms] = useState<Form[]>([]);
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [volunteerHours, setVolunteerHours] = useState<VolunteerHourRow[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<FormSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ----- View state -----
  const [reportType, setReportType] = useState<ReportType>("impact");
  const [selectedFormId, setSelectedFormId] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  // ----- Report period (shared by all tabs except inventory) -----
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  /**
   * Load everything the reports need.
   *
   * Fixes over the original:
   * - Fetches all pages (see fetchAll), not just the first 1000 rows.
   * - Errors were ignored and showed as empty reports. Each dataset now loads
   *   independently, and any that fail are named in a toast.
   * - With no user, the loading skeleton never went away.
   * - Ignores results that arrive after the user changed or the page closed.
   */
  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    const uid = user.id;

    const load = async () => {
      setIsLoading(true);
      const failed: string[] = [];

      // A secondary order on "id" keeps paging stable when many rows share a date.
      const [formsRes, donationsRes, hoursRes, inventoryRes] = await Promise.allSettled([
        fetchAll<Form>((f, t) =>
          supabase.from("forms").select("*").eq("user_id", uid).eq("is_archived", false).order("created_at").order("id").range(f, t),
        ),
        fetchAll<DonationRow>((f, t) =>
          supabase.from("donations").select("*").eq("user_id", uid).order("date").order("id").range(f, t),
        ),
        fetchAll<VolunteerHourRow>((f, t) =>
          supabase.from("volunteer_hours").select("*").eq("user_id", uid).order("date").order("id").range(f, t),
        ),
        fetchAll<InventoryRow>((f, t) =>
          supabase.from("inventory_items").select("*").eq("user_id", uid).order("name").order("id").range(f, t),
        ),
      ]);

      const take = <T,>(res: PromiseSettledResult<T[]>, label: string): T[] => {
        if (res.status === "fulfilled") return res.value;
        failed.push(label);
        return [];
      };

      const formList = take(formsRes, "forms");
      const donationList = take(donationsRes, "donations");
      const hourList = take(hoursRes, "volunteer hours");
      const inventoryList = take(inventoryRes, "inventory");

      // Submissions for all of the user's (non-archived) forms.
      let submissionList: FormSubmission[] = [];
      if (formList.length) {
        try {
          const ids = formList.map((f) => f.id);
          submissionList = await fetchAll<FormSubmission>((f, t) =>
            supabase
              .from("form_submissions")
              .select("*")
              .in("form_id", ids)
              .order("submitted_at", { ascending: false })
              .order("id")
              .range(f, t),
          );
        } catch {
          failed.push("form responses");
        }
      }

      if (cancelled) return;
      setForms(formList);
      setDonations(donationList);
      setVolunteerHours(hourList);
      setInventory(inventoryList);
      setAllSubmissions(submissionList);
      setIsLoading(false);

      if (failed.length) {
        toast({
          title: "Some report data could not be loaded",
          description: `Missing: ${failed.join(", ")}. Totals below may be incomplete. Refresh to try again.`,
          variant: "destructive",
        });
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [user, toast]);

  // -------------------------------------------------------------------------
  // Period controls
  // -------------------------------------------------------------------------

  /** Pick a preset period; fills in the from/to dates. */
  const applyPreset = (preset: PeriodPreset) => {
    setPeriodPreset(preset);
    if (preset !== "custom") {
      const { from, to } = getPresetRange(preset);
      setDateFrom(from);
      setDateTo(to);
    }
  };

  /** Editing a date directly switches the preset to "Custom". */
  const changeDate = (which: "from" | "to", value: string) => {
    setPeriodPreset("custom");
    if (which === "from") setDateFrom(value);
    else setDateTo(value);
  };

  const periodLabel = describePeriod(dateFrom, dateTo);
  const periodError = dateFrom && dateTo && dateFrom > dateTo ? "The start date is after the end date." : null;

  // -------------------------------------------------------------------------
  // Period-filtered data
  // -------------------------------------------------------------------------

  const periodDonations = useMemo(
    () => donations.filter((d) => inRange(d.date, dateFrom, dateTo)),
    [donations, dateFrom, dateTo],
  );
  const periodHours = useMemo(
    () => volunteerHours.filter((v) => inRange(v.date, dateFrom, dateTo)),
    [volunteerHours, dateFrom, dateTo],
  );
  const periodSubmissions = useMemo(
    () => allSubmissions.filter((s) => inRange(submittedDate(s), dateFrom, dateTo)),
    [allSubmissions, dateFrom, dateTo],
  );

  // -------------------------------------------------------------------------
  // Donation figures
  // -------------------------------------------------------------------------

  const donationStats = useMemo(() => {
    const total = periodDonations.reduce((s, d) => s + Number(d.amount), 0);
    return {
      total,
      count: periodDonations.length,
      uniqueDonors: new Set(periodDonations.map((d) => normalizeName(d.donor_name))).size,
      average: periodDonations.length ? total / periodDonations.length : 0,
      byMonth: buildTimeSeries(periodDonations.map((d) => ({ date: d.date, value: Number(d.amount) })), "month"),
      byCampaign: sumBy(periodDonations, (d) => d.campaign?.trim() || "General", (d) => Number(d.amount)),
      // Counted by number of gifts AND amount, so both are available.
      byMethodCount: sumBy(periodDonations, (d) => d.payment_method || "Unknown", () => 1),
    };
  }, [periodDonations]);

  /** Newest first for the on-screen table. */
  const donationsNewestFirst = useMemo(
    () => [...periodDonations].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [periodDonations],
  );

  // -------------------------------------------------------------------------
  // Volunteer figures
  // -------------------------------------------------------------------------

  const volunteerStats = useMemo(() => {
    const totalHours = periodHours.reduce((s, v) => s + Number(v.hours), 0);
    const byVolunteer = sumBy(periodHours, (v) => v.volunteer_name.trim(), (v) => Number(v.hours));
    return {
      totalHours,
      volunteers: new Set(periodHours.map((v) => normalizeName(v.volunteer_name))).size,
      sessions: periodHours.length,
      average: periodHours.length ? totalHours / periodHours.length : 0,
      // Full name kept for the tooltip; short label for the axis.
      top: byVolunteer.slice(0, 10).map((v) => ({ fullName: v.name, label: shorten(v.name, 14), hours: v.value })),
      allVolunteers: byVolunteer,
      byActivity: sumBy(periodHours, (v) => v.activity?.trim() || "Other", (v) => Number(v.hours)),
      byMonth: buildTimeSeries(periodHours.map((v) => ({ date: v.date, value: Number(v.hours) })), "month"),
    };
  }, [periodHours]);

  // -------------------------------------------------------------------------
  // Inventory figures (current snapshot; not affected by the period)
  // -------------------------------------------------------------------------

  const inventoryStats = useMemo(() => {
    const lowItems = inventory.filter(isLowStock);
    const outItems = inventory.filter(isOutOfStock);
    return {
      total: inventory.length,
      low: lowItems.length,
      out: outItems.length,
      restock: inventory.filter(needsRestock).sort((a, b) => getQty(a) - getQty(b)),
      byCategory: sumBy(inventory, (i) => i.category?.trim() || "Uncategorized", () => 1),
      chart: inventory.map((i) => ({
        id: i.id,
        fullName: i.name,
        label: shorten(i.name, 12),
        quantity: getQty(i),
        unit: i.unit,
        restock: needsRestock(i),
      })),
    };
  }, [inventory]);

  // -------------------------------------------------------------------------
  // Form figures
  // -------------------------------------------------------------------------

  const selectedForm = forms.find((f) => f.id === selectedFormId);
  const formFields = useMemo(() => (selectedForm?.fields as FormField[] | null) ?? [], [selectedForm]);

  /**
   * Submissions for the selected form, within the period.
   * The original made a second request every time a form was picked, with no
   * protection against an older response overwriting a newer one when
   * switching forms quickly. All submissions are already loaded, so this
   * just filters them.
   */
  const formSubmissions = useMemo(
    () => (selectedFormId ? periodSubmissions.filter((s) => s.form_id === selectedFormId) : []),
    [periodSubmissions, selectedFormId],
  );

  /** formSubmissions narrowed by the search box (matches any answer). */
  const filteredSubmissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return formSubmissions;
    return formSubmissions.filter((s) =>
      Object.values((s.data as Record<string, unknown>) ?? {}).some((v) => formatAnswer(v).toLowerCase().includes(q)),
    );
  }, [formSubmissions, searchQuery]);

  /** Submissions-over-time series; daily for short spans, monthly for long ones. */
  const submissionsSeries = useMemo(() => {
    const dates = filteredSubmissions.map(submittedDate);
    return buildTimeSeries(dates.map((date) => ({ date, value: 1 })), pickGranularity(dates));
  }, [filteredSubmissions]);

  /**
   * Recent activity for the selected form. Uses all of its submissions,
   * ignoring the period, since "last 7 days" is always relative to today.
   * Labeled "Last 7/30 days"; the original called these "This Week" and
   * "This Month" while actually counting rolling windows.
   */
  const recentCounts = useMemo(() => {
    const forForm = allSubmissions.filter((s) => s.form_id === selectedFormId);
    const now = Date.now();
    const within = (days: number) =>
      forForm.filter((s) => s.submitted_at && now - new Date(s.submitted_at).getTime() <= days * 86400000).length;
    const latest = forForm.reduce<string | null>(
      (max, s) => (s.submitted_at && (!max || s.submitted_at > max) ? s.submitted_at : max),
      null,
    );
    return { last7: within(7), last30: within(30), latest };
  }, [allSubmissions, selectedFormId]);

  /** Responses per form within the period, for the "All forms" overview chart. */
  const submissionsPerForm = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of periodSubmissions) counts.set(s.form_id, (counts.get(s.form_id) ?? 0) + 1);
    return forms
      .map((f) => ({ id: f.id, fullName: f.title, label: shorten(f.title, 16), submissions: counts.get(f.id) ?? 0 }))
      .sort((a, b) => b.submissions - a.submissions);
  }, [forms, periodSubmissions]);

  const choiceFields = formFields.filter((f) => CHOICE_FIELD_TYPES.includes(f.type));
  const numberFields = formFields.filter((f) => f.type === "number");

  /** Switching forms clears the search, since it rarely applies to another form. */
  const selectForm = (value: string) => {
    setSelectedFormId(value === ALL_FORMS ? "" : value);
    setSearchQuery("");
  };

  // -------------------------------------------------------------------------
  // CSV export
  // -------------------------------------------------------------------------

  /** Whether the current tab has anything to export. Buttons are disabled otherwise. */
  const canExport =
    reportType === "impact" ||
    (reportType === "donations" && periodDonations.length > 0) ||
    (reportType === "volunteers" && periodHours.length > 0) ||
    (reportType === "inventory" && inventory.length > 0) ||
    (reportType === "forms" && Boolean(selectedForm) && filteredSubmissions.length > 0);

  /**
   * Download the current tab's data as CSV.
   *
   * Fixes over the original:
   * - The Impact tab produced no file at all; it now exports a summary.
   * - Values are escaped properly (see csvCell).
   * - Forms export the submissions you see (search and period applied).
   * - File names include the date so repeated exports do not overwrite each other.
   */
  const exportCSV = () => {
    if (!canExport) return;
    const stamp = toISODate(new Date());
    let rows: unknown[][] = [];

    switch (reportType) {
      case "impact":
        rows = [
          ["Report period", periodLabel],
          [],
          ["Metric", "Value"],
          ["Total raised", donationStats.total.toFixed(2)],
          ["Donations", donationStats.count],
          ["Unique donors", donationStats.uniqueDonors],
          ["Volunteer hours", formatHours(volunteerStats.totalHours)],
          ["Volunteers", volunteerStats.volunteers],
          ["Form responses", periodSubmissions.length],
          ["Inventory items (current)", inventoryStats.total],
          [],
          ["Campaign", "Total raised"],
          ...donationStats.byCampaign.map((c) => [c.name, c.value.toFixed(2)]),
          [],
          ["Volunteer", "Hours"],
          ...volunteerStats.allVolunteers.map((v) => [v.name, formatHours(v.value)]),
        ];
        break;
      case "donations":
        rows = [
          ["Donor", "Amount", "Date", "Campaign", "Payment Method", "Notes"],
          ...periodDonations.map((d) => [
            d.donor_name,
            Number(d.amount).toFixed(2),
            d.date,
            d.campaign ?? "",
            d.payment_method ?? "",
            d.notes ?? "",
          ]),
        ];
        break;
      case "volunteers":
        rows = [
          ["Volunteer", "Activity", "Hours", "Date", "Notes"],
          ...periodHours.map((v) => [v.volunteer_name, v.activity ?? "", Number(v.hours), v.date, v.notes ?? ""]),
        ];
        break;
      case "inventory":
        rows = [
          ["Name", "Category", "Quantity", "Unit", "Condition", "Location", "Low Stock Threshold", "Status"],
          ...inventory.map((i) => [
            i.name,
            i.category ?? "",
            getQty(i),
            i.unit ?? "",
            i.condition ?? "",
            i.location ?? "",
            getThreshold(i),
            isOutOfStock(i) ? "Out of stock" : isLowStock(i) ? "Low stock" : "In stock",
          ]),
        ];
        break;
      case "forms":
        rows = [
          ["Submitted At", ...formFields.map((f) => f.label)],
          ...filteredSubmissions.map((s) => [
            s.submitted_at ? new Date(s.submitted_at).toLocaleString("en-US") : "",
            ...formFields.map((f) => formatAnswer(getAnswer(s, f.id))),
          ]),
        ];
        break;
    }

    const name = reportType === "forms" && selectedForm ? `form-${selectedForm.title}` : reportType;
    const safeName = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    downloadCsv(`${safeName}-report-${stamp}.csv`, rows);
  };

  // -------------------------------------------------------------------------
  // PDF export
  // -------------------------------------------------------------------------

  /**
   * Open a print-ready report in a new tab and start the print dialog.
   *
   * Fixes over the original:
   * - All user data is HTML-escaped (see escapeHtml). This closes a
   *   cross-site scripting hole via public form submissions.
   * - The page also gets a Content-Security-Policy that blocks scripts
   *   entirely, as a second layer of protection.
   * - The report title was mangled by a regex ("Impact Overview" printed as
   *   "Overview", and three reports were all titled "Report").
   * - A blocked pop-up now shows a message instead of failing silently.
   * - Printing waits for the page to load instead of a fixed 600ms delay.
   * - Reports include the selected period, and the forms report prints the
   *   submissions you see on screen (search and period applied).
   */
  const exportPDF = () => {
    if (!canExport) return;
    setIsExporting(true);

    const w = window.open("", "_blank");
    if (!w) {
      setIsExporting(false);
      toast({
        title: "Pop-up blocked",
        description: "Allow pop-ups for this site to export a PDF, then try again.",
        variant: "destructive",
      });
      return;
    }

    const h = escapeHtml;
    const generated = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    const reportLabel = REPORT_TYPES.find((r) => r.value === reportType)?.label ?? "Report";

    /** Row of headline numbers. Values are escaped here. */
    const statBlock = (items: [string, string | number][]) =>
      `<div class="stats-row">${items
        .map(([label, value]) => `<div class="stat"><strong>${h(value)}</strong><span>${h(label)}</span></div>`)
        .join("")}</div>`;

    /** Table with every cell escaped here, so no call site can forget. */
    const tableBlock = (headers: string[], rows: (string | number)[][], highlightRow?: (i: number) => boolean) =>
      `<table><thead><tr>${headers.map((x) => `<th>${h(x)}</th>`).join("")}</tr></thead><tbody>${rows
        .map(
          (r, i) =>
            `<tr${highlightRow?.(i) ? ' class="highlight"' : ""}>${r.map((c) => `<td>${h(c)}</td>`).join("")}</tr>`,
        )
        .join("")}</tbody></table>`;

    let body = "";
    switch (reportType) {
      case "impact":
        body = `
          <h2>Organization impact summary</h2>
          ${statBlock([
            ["Total raised", formatCurrency(donationStats.total)],
            ["Volunteer hours", formatHours(volunteerStats.totalHours)],
            ["Form responses", periodSubmissions.length.toLocaleString("en-US")],
            ["Inventory items", inventoryStats.total.toLocaleString("en-US")],
          ])}
          <h2>Donations by campaign</h2>
          ${tableBlock(["Campaign", "Total"], donationStats.byCampaign.map((c) => [c.name, formatCurrency(c.value)]))}
          <h2>Top volunteers</h2>
          ${tableBlock(["Volunteer", "Hours"], volunteerStats.top.map((v) => [v.fullName, formatHours(v.hours)]))}
        `;
        break;
      case "donations":
        body = `
          ${statBlock([
            ["Total raised", formatCurrency(donationStats.total)],
            ["Donations", donationStats.count],
            ["Unique donors", donationStats.uniqueDonors],
            ["Average gift", formatCurrency(donationStats.average)],
          ])}
          <h2>By campaign</h2>
          ${tableBlock(["Campaign", "Total"], donationStats.byCampaign.map((c) => [c.name, formatCurrency(c.value)]))}
          <h2>All donations</h2>
          ${tableBlock(
            ["Donor", "Amount", "Date", "Campaign", "Method"],
            donationsNewestFirst.map((d) => [
              d.donor_name,
              formatCurrency(Number(d.amount)),
              formatDate(d.date),
              d.campaign ?? "-",
              d.payment_method ?? "-",
            ]),
          )}
        `;
        break;
      case "volunteers":
        body = `
          ${statBlock([
            ["Total hours", formatHours(volunteerStats.totalHours)],
            ["Volunteers", volunteerStats.volunteers],
            ["Sessions", volunteerStats.sessions],
            ["Average session", `${formatHours(volunteerStats.average)} hrs`],
          ])}
          <h2>Hours by volunteer</h2>
          ${tableBlock(["Volunteer", "Hours"], volunteerStats.allVolunteers.map((v) => [v.name, formatHours(v.value)]))}
          <h2>All volunteer sessions</h2>
          ${tableBlock(
            ["Volunteer", "Activity", "Hours", "Date"],
            periodHours.map((v) => [v.volunteer_name, v.activity ?? "-", formatHours(Number(v.hours)), formatDate(v.date)]),
          )}
        `;
        break;
      case "inventory":
        body = `
          ${statBlock([
            ["Total items", inventoryStats.total],
            ["Low stock", inventoryStats.low],
            ["Out of stock", inventoryStats.out],
            ["Categories", inventoryStats.byCategory.length],
          ])}
          <h2>Inventory</h2>
          ${tableBlock(
            ["Item", "Category", "Qty", "Unit", "Condition", "Location"],
            inventory.map((i) => [
              i.name,
              i.category ?? "-",
              getQty(i),
              i.unit ?? "-",
              i.condition ?? "-",
              i.location ?? "-",
            ]),
            (idx) => needsRestock(inventory[idx]),
          )}
        `;
        break;
      case "forms":
        body = `
          ${statBlock([
            ["Submissions", filteredSubmissions.length],
            ["Fields", formFields.length],
          ])}
          <h2>All submissions: ${h(selectedForm?.title ?? "")}</h2>
          ${searchQuery.trim() ? `<p class="note">Filtered by search: "${h(searchQuery.trim())}"</p>` : ""}
          ${tableBlock(
            ["#", ...formFields.map((f) => f.label), "Date"],
            filteredSubmissions.map((s, i) => [
              i + 1,
              ...formFields.map((f) => formatAnswer(getAnswer(s, f.id)) || "-"),
              s.submitted_at ? new Date(s.submitted_at).toLocaleDateString("en-US") : "-",
            ]),
          )}
        `;
        break;
    }

    const periodLine = reportType === "inventory" ? "Current stock" : `Period: ${periodLabel}`;

    w.document.write(`<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
      <title>${h(`HumMotion ${reportLabel} - ${generated}`)}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Georgia, serif; max-width: 960px; margin: 0 auto; padding: 48px 40px; color: #111; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 20px; margin-bottom: 32px; }
        .header h1 { font-size: 30px; margin: 0 0 4px; }
        .header p { margin: 0; color: #555; font-size: 13px; font-style: italic; }
        .logo { font-size: 13px; color: #888; text-align: right; }
        h2 { font-size: 18px; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-top: 36px; }
        .note { font-size: 12px; color: #666; font-style: italic; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
        thead { display: table-header-group; } /* repeat headers on each printed page */
        tr { page-break-inside: avoid; }
        th { background: #f4f4f4; text-align: left; padding: 8px 12px; border: 1px solid #ddd; font-weight: 600; }
        td { padding: 7px 12px; border: 1px solid #ddd; vertical-align: top; word-break: break-word; }
        tr:nth-child(even) td { background: #fafafa; }
        tr.highlight td { background: #fff0f0; }
        .stats-row { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 16px; }
        .stat { background: #f4f6fa; border-radius: 8px; padding: 16px 24px; text-align: center; flex: 1; min-width: 120px; }
        .stat strong { display: block; font-size: 26px; color: #1a3f8f; margin-bottom: 4px; }
        .stat span { font-size: 12px; color: #666; }
        .footer { margin-top: 48px; border-top: 1px solid #ddd; padding-top: 16px; font-size: 11px; color: #aaa; text-align: center; }
        @media print { body { padding: 24px; } * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      </style>
    </head><body>
      <div class="header">
        <div>
          <h1>${h(reportLabel)}</h1>
          <p>${h(periodLine)}</p>
          <p>Generated ${h(generated)}</p>
        </div>
        <div class="logo">HumMotion<br/>Impact Reporting</div>
      </div>
      ${body}
      <div class="footer">Generated by HumMotion, ${h(generated)}. Confidential.</div>
    </body></html>`);
    w.document.close();

    // Print once the new page has finished loading (fonts and layout ready).
    const triggerPrint = () => {
      w.focus();
      w.print();
    };
    if (w.document.readyState === "complete") setTimeout(triggerPrint, 250);
    else w.addEventListener("load", triggerPrint, { once: true });
    setIsExporting(false);
  };

  // -------------------------------------------------------------------------
  // Render: loading
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render: page
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ===== Header and export buttons ===== */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Reports</h1>
          <p className="text-muted-foreground">Visual reports for your board, donors, and grant applications</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!canExport}>
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> CSV
          </Button>
          <Button size="sm" onClick={exportPDF} disabled={!canExport || isExporting}>
            <FileDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {isExporting ? "Preparing..." : "Export PDF"}
          </Button>
        </div>
      </div>

      {/* ===== Report type tabs =====
          role="tablist"/"tab" lets screen readers announce these as tabs and
          which one is selected. The icons were defined but never shown before. */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Report type">
        {REPORT_TYPES.map((rt) => {
          const Icon = rt.icon;
          const isActive = reportType === rt.value;
          return (
            <button
              key={rt.value}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setReportType(rt.value)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border hover:border-primary/60 hover:bg-muted"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {rt.label}
            </button>
          );
        })}
      </div>

      {/* ===== Report period (hidden on Inventory, which is always current) ===== */}
      {reportType !== "inventory" ? (
        <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium">Report period</span>
            <span className="text-sm text-muted-foreground">{periodLabel}</span>
            {periodPreset !== "all" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => applyPreset("all")}
                className="ml-auto h-7 text-xs text-muted-foreground"
              >
                <X className="mr-1 h-3 w-3" aria-hidden="true" /> Show all time
              </Button>
            )}
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="period-preset" className="text-xs text-muted-foreground">
                Quick select
              </Label>
              <Select value={periodPreset} onValueChange={(v) => applyPreset(v as PeriodPreset)}>
                <SelectTrigger id="period-preset" className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_PRESETS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom dates</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-from" className="text-xs text-muted-foreground">
                From
              </Label>
              <Input
                id="period-from"
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => changeDate("from", e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input
                id="period-to"
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => changeDate("to", e.target.value)}
                className="h-9 text-sm"
              />
            </div>
          </div>
          {periodError && (
            <p role="alert" className="text-xs text-destructive">
              {periodError}
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Inventory reports always show current stock levels.</p>
      )}

      {/* =================================================================
          IMPACT OVERVIEW
          ================================================================= */}
      {reportType === "impact" && (
        <div className="space-y-6">
          <StatGrid
            stats={[
              { label: "Total raised", value: formatCurrency(donationStats.total), icon: DollarSign },
              { label: "Volunteer hours", value: formatHours(volunteerStats.totalHours), icon: Clock },
              { label: "Form responses", value: periodSubmissions.length.toLocaleString("en-US"), icon: FileText },
              { label: "Inventory items", value: inventoryStats.total.toLocaleString("en-US"), icon: Package },
            ]}
          />

          <div className="grid sm:grid-cols-2 gap-6">
            <ChartCard title="Donations by month">
              <TimeSeriesChart
                data={donationStats.byMonth}
                kind="area"
                seriesName="Donations"
                valueFormatter={formatCurrency}
                yTickFormatter={(v) => `$${v.toLocaleString("en-US")}`}
              />
            </ChartCard>
            <ChartCard title="Volunteer hours by month">
              <TimeSeriesChart
                data={volunteerStats.byMonth}
                kind="bar"
                color={COLORS[2]}
                seriesName="Hours"
                valueFormatter={(v) => `${formatHours(v)} hrs`}
              />
            </ChartCard>
          </div>

          {/* Restock alerts (current stock, independent of the period). */}
          {inventoryStats.restock.length > 0 && (
            <Card className="p-5 border-destructive/40 bg-destructive/5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
                <h3 className="font-semibold text-destructive">Items needing restock</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {inventoryStats.restock.map((i) => (
                  <Badge key={i.id} variant="destructive">
                    {i.name}: {isOutOfStock(i) ? "out of stock" : `${getQty(i)} left`}
                  </Badge>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* =================================================================
          DONATION REPORT
          ================================================================= */}
      {reportType === "donations" && (
        <div className="space-y-6">
          <StatGrid
            stats={[
              { label: "Total raised", value: formatCurrency(donationStats.total) },
              { label: "Donations", value: donationStats.count.toLocaleString("en-US") },
              { label: "Unique donors", value: donationStats.uniqueDonors.toLocaleString("en-US") },
              { label: "Average gift", value: formatCurrency(donationStats.average) },
            ]}
          />

          <div className="grid sm:grid-cols-3 gap-6">
            <ChartCard title="Donations over time" className="sm:col-span-2">
              <TimeSeriesChart
                data={donationStats.byMonth}
                kind="area"
                seriesName="Total"
                valueFormatter={formatCurrency}
                yTickFormatter={(v) => `$${v.toLocaleString("en-US")}`}
                heightClass="h-56"
              />
            </ChartCard>

            <div className="space-y-6">
              <ChartCard title="By campaign">
                <DonutChart data={donationStats.byCampaign} valueFormatter={formatCurrency} legendLimit={4} heightClass="h-36" />
              </ChartCard>
              <ChartCard title="By payment method">
                <DonutChart
                  data={donationStats.byMethodCount}
                  valueFormatter={(v) => `${v} ${v === 1 ? "gift" : "gifts"}`}
                  legendLimit={5}
                  heightClass="h-32"
                />
              </ChartCard>
            </div>
          </div>

          {/* Donation table (capped on screen; exports include everything). */}
          {periodDonations.length > 0 ? (
            <Card className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Donor</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Method</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {donationsNewestFirst.slice(0, MAX_TABLE_ROWS).map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.donor_name}</TableCell>
                      <TableCell className="text-right text-primary font-semibold whitespace-nowrap">
                        {formatCurrency(Number(d.amount))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(d.date)}</TableCell>
                      <TableCell>{d.campaign ? <Badge variant="secondary">{d.campaign}</Badge> : "-"}</TableCell>
                      <TableCell>{d.payment_method ?? "-"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {periodDonations.length > MAX_TABLE_ROWS && (
                <p className="p-3 text-xs text-muted-foreground text-center border-t">
                  Showing the latest {MAX_TABLE_ROWS} of {periodDonations.length.toLocaleString("en-US")} donations. Export
                  CSV or PDF for the full list.
                </p>
              )}
            </Card>
          ) : (
            <EmptyChart
              message={donations.length ? "No donations in this period" : "No donations recorded yet"}
            />
          )}
        </div>
      )}

      {/* =================================================================
          VOLUNTEER REPORT
          ================================================================= */}
      {reportType === "volunteers" && (
        <div className="space-y-6">
          <StatGrid
            stats={[
              { label: "Total hours", value: formatHours(volunteerStats.totalHours) },
              { label: "Volunteers", value: volunteerStats.volunteers.toLocaleString("en-US") },
              { label: "Sessions", value: volunteerStats.sessions.toLocaleString("en-US") },
              {
                label: "Average session",
                value: volunteerStats.sessions ? `${formatHours(volunteerStats.average)} hrs` : "-",
              },
            ]}
          />

          <div className="grid sm:grid-cols-2 gap-6">
            <ChartCard title="Top volunteers">
              {volunteerStats.top.length > 0 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={volunteerStats.top} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis type="number" tick={AXIS_TICK} />
                      <YAxis type="category" dataKey="label" width={100} tick={AXIS_TICK} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                        formatter={(v) => [`${formatHours(Number(v))} hrs`, "Hours"]}
                      />
                      <Bar dataKey="hours" fill={COLORS[2]} radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyChart />
              )}
            </ChartCard>

            <ChartCard title="Hours by activity">
              <DonutChart data={volunteerStats.byActivity} valueFormatter={(v) => `${formatHours(v)} hrs`} />
            </ChartCard>
          </div>

          <ChartCard title="Hours over time">
            <TimeSeriesChart
              data={volunteerStats.byMonth}
              kind="bar"
              color={COLORS[2]}
              seriesName="Hours"
              valueFormatter={(v) => `${formatHours(v)} hrs`}
              heightClass="h-48"
            />
          </ChartCard>
        </div>
      )}

      {/* =================================================================
          INVENTORY REPORT
          ================================================================= */}
      {reportType === "inventory" && (
        <div className="space-y-6">
          <StatGrid
            stats={[
              { label: "Total items", value: inventoryStats.total },
              { label: "Low stock", value: inventoryStats.low, danger: inventoryStats.low > 0 },
              { label: "Out of stock", value: inventoryStats.out, danger: inventoryStats.out > 0 },
              { label: "Categories", value: inventoryStats.byCategory.length },
            ]}
          />

          <div className="grid sm:grid-cols-2 gap-6">
            <ChartCard title="Stock levels">
              {inventoryStats.chart.length > 0 ? (
                // Scrolls sideways for many items so labels stay readable.
                <div className="overflow-x-auto">
                  <div className="h-56" style={{ minWidth: Math.max(inventoryStats.chart.length * 40, 300) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={inventoryStats.chart} margin={{ bottom: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                        <XAxis
                          dataKey="label"
                          tick={{ ...AXIS_TICK, fontSize: 10 }}
                          angle={-30}
                          textAnchor="end"
                          interval={0}
                        />
                        <YAxis tick={AXIS_TICK} allowDecimals={false} />
                        <Tooltip
                          contentStyle={TOOLTIP_STYLE}
                          labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                          formatter={(v, _n, entry) => [`${v} ${entry?.payload?.unit ?? "units"}`, "Quantity"]}
                        />
                        <Bar dataKey="quantity" radius={[4, 4, 0, 0]}>
                          {inventoryStats.chart.map((item) => (
                            <Cell key={item.id} fill={item.restock ? "hsl(var(--destructive))" : COLORS[0]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <EmptyChart message="No inventory items yet" />
              )}
            </ChartCard>

            <ChartCard title="Items by category">
              <DonutChart
                data={inventoryStats.byCategory}
                valueFormatter={(v) => `${v} ${v === 1 ? "item" : "items"}`}
                legendLimit={8}
              />
            </ChartCard>
          </div>

          {inventoryStats.restock.length > 0 && (
            <Card className="p-5 border-destructive/40 bg-destructive/5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
                <h3 className="font-semibold text-destructive">Needs restocking</h3>
              </div>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Threshold</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Location</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {inventoryStats.restock.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-medium">{i.name}</TableCell>
                        <TableCell>
                          <Badge variant="destructive">
                            {getQty(i)} {i.unit ?? ""}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{getThreshold(i)}</TableCell>
                        <TableCell>{i.category ?? "-"}</TableCell>
                        <TableCell>{i.location ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* =================================================================
          FORM SUBMISSIONS REPORT
          ================================================================= */}
      {reportType === "forms" && (
        <div className="space-y-6">
          {/* Form picker, response count and search */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="report-form" className="text-xs text-muted-foreground">
                Form
              </Label>
              <Select value={selectedFormId || ALL_FORMS} onValueChange={selectForm}>
                <SelectTrigger id="report-form" className="w-72">
                  <SelectValue placeholder="Select a form..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_FORMS}>All forms (overview)</SelectItem>
                  {forms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedForm && formSubmissions.length > 0 && (
              <div className="space-y-1.5 flex-1 min-w-[200px] max-w-sm">
                <Label htmlFor="report-search" className="text-xs text-muted-foreground">
                  Search responses
                </Label>
                <div className="relative">
                  <Search
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    id="report-search"
                    placeholder="Search all answers..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-8 pr-8 h-9 text-sm"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      aria-label="Clear search"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {selectedForm && (
              <Badge variant="secondary" className="mb-2">
                {filteredSubmissions.length.toLocaleString("en-US")}
                {filteredSubmissions.length !== formSubmissions.length
                  ? ` of ${formSubmissions.length.toLocaleString("en-US")}`
                  : ""}{" "}
                {formSubmissions.length === 1 ? "submission" : "submissions"}
              </Badge>
            )}
          </div>

          {/* Content: overview, empty states, or the selected form's report */}
          {!selectedForm ? (
            <ChartCard title="Submissions by form">
              {forms.length > 0 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={submissionsPerForm}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="label" tick={AXIS_TICK} interval={0} />
                      <YAxis tick={AXIS_TICK} allowDecimals={false} />
                      <Tooltip
                        contentStyle={TOOLTIP_STYLE}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                        formatter={(v) => [v, "Submissions"]}
                      />
                      <Bar dataKey="submissions" fill={COLORS[0]} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyChart message="No forms yet" />
              )}
            </ChartCard>
          ) : formSubmissions.length === 0 ? (
            <EmptyChart
              message={
                allSubmissions.some((s) => s.form_id === selectedFormId)
                  ? "No submissions for this form in this period"
                  : "No submissions for this form yet"
              }
            />
          ) : filteredSubmissions.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <Search className="h-6 w-6 text-muted-foreground mx-auto" aria-hidden="true" />
              <p className="text-sm font-medium">No responses match "{searchQuery}"</p>
              <Button variant="outline" size="sm" onClick={() => setSearchQuery("")}>
                Clear search
              </Button>
            </div>
          ) : (
            <>
              <StatGrid
                stats={[
                  { label: "In this report", value: filteredSubmissions.length.toLocaleString("en-US") },
                  { label: "Last 7 days", value: recentCounts.last7.toLocaleString("en-US") },
                  { label: "Last 30 days", value: recentCounts.last30.toLocaleString("en-US") },
                  {
                    label: "Latest response",
                    value: recentCounts.latest ? formatDate(toISODate(new Date(recentCounts.latest))) : "-",
                  },
                ]}
              />

              {submissionsSeries.length > 1 && (
                <ChartCard title="Submissions over time">
                  <TimeSeriesChart data={submissionsSeries} kind="line" seriesName="Submissions" heightClass="h-48" />
                </ChartCard>
              )}

              {/* One donut per choice field (dropdown, radio, checkbox). */}
              {choiceFields.length > 0 && (
                <div className="grid sm:grid-cols-2 gap-6">
                  {choiceFields.map((field) => (
                    <ChartCard key={field.id} title={field.label || "Untitled field"}>
                      <DonutChart
                        data={summarizeChoices(field, filteredSubmissions)}
                        valueFormatter={(v) => `${v} ${v === 1 ? "response" : "responses"}`}
                        heightClass="h-44"
                        showLabels
                      />
                    </ChartCard>
                  ))}
                </div>
              )}

              {/* Statistics for number fields. */}
              {numberFields.map((field) => {
                const summary = summarizeNumbers(field, filteredSubmissions);
                if (!summary) return null;
                const fmt = (n: number) => (Math.round(n * 10) / 10).toLocaleString("en-US");
                return (
                  <ChartCard key={field.id} title={`${field.label || "Untitled field"}: statistics`}>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(
                        [
                          ["Average", fmt(summary.avg)],
                          ["Minimum", fmt(summary.min)],
                          ["Maximum", fmt(summary.max)],
                          ["Total", fmt(summary.sum)],
                        ] as const
                      ).map(([label, value]) => (
                        <div key={label} className="text-center p-4 bg-muted/40 rounded-md">
                          <p className="text-xl font-bold">{value}</p>
                          <p className="text-xs text-muted-foreground">{label}</p>
                        </div>
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Based on {summary.count} {summary.count === 1 ? "answer" : "answers"}.
                    </p>
                  </ChartCard>
                );
              })}

              {/* Submissions table (capped on screen; exports include everything). */}
              <Card className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      {formFields.map((f) => (
                        <TableHead key={f.id}>{f.label}</TableHead>
                      ))}
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSubmissions.slice(0, MAX_TABLE_ROWS).map((sub, idx) => (
                      <TableRow key={sub.id}>
                        <TableCell className="text-muted-foreground text-xs">{idx + 1}</TableCell>
                        {formFields.map((f) => {
                          const text = formatAnswer(getAnswer(sub, f.id));
                          return (
                            // title shows the full answer on hover since the cell is truncated.
                            <TableCell key={f.id} className="max-w-[160px] truncate" title={text || undefined}>
                              {text || "-"}
                            </TableCell>
                          );
                        })}
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString("en-US") : "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {filteredSubmissions.length > MAX_TABLE_ROWS && (
                  <p className="p-3 text-xs text-muted-foreground text-center border-t">
                    Showing the latest {MAX_TABLE_ROWS} of {filteredSubmissions.length.toLocaleString("en-US")}{" "}
                    submissions. Export CSV or PDF for the full list.
                  </p>
                )}
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}