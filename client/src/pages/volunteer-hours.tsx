/**
 * VolunteerHoursPage
 *
 * Log and review volunteer time for grant applications and impact reports.
 * Rows are stored in the Supabase "volunteer_hours" table, scoped to the user.
 *
 * Features:
 *   - Log hours for one volunteer, or several volunteers at once (bulk mode)
 *   - Filter by search text, volunteer, activity and date range
 *   - Sortable, paginated table with edit and delete
 *   - Stats, an optional dollar value per hour, and a chart by volunteer,
 *     activity or month
 *   - CSV exports: full detail, or a summary by activity and volunteer
 *   - Organizations can rename or hide fields, split names into first and
 *     last, and add their own fields (lib/tracker-fields.ts)
 *
 * Backend assumptions:
 *   - Columns: id, user_id, volunteer_name, activity, hours (numeric),
 *     date ("YYYY-MM-DD"), notes, created_at.
 *   - Migration 011 adds custom (jsonb), first_name and last_name. Those are
 *     only sent when it has been run (fields.isAvailable), so saving still
 *     works on databases without them.
 *   - Row Level Security limits rows to the user's organization and blocks
 *     changes from viewers. user_id records who logged the entry; it isn't
 *     used for access.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { friendlyWriteError } from "@/lib/db-errors";
import {
  Plus,
  Clock,
  Trash2,
  Pencil,
  Download,
  Users,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  AlertCircle,
  AlertTriangle,
  Upload,
  X,
} from "lucide-react";
import { ImportDialog } from "@/components/import-dialog";
import { CustomFieldInputs, SplitNameInputs } from "@/components/custom-field-inputs";
import { CustomizeFieldsButton } from "@/components/customize-fields-dialog";
import {
  useTrackerFields,
  prepareCustomValues,
  customOf,
  formatCustomValue,
  joinName,
  splitName,
  type CustomValues,
} from "@/lib/tracker-fields";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ===========================================================================
// Types
// ===========================================================================

interface VolunteerHour {
  id: string;
  volunteer_name: string;
  activity: string;
  /** Always a number after loading (see normalizeRow). */
  hours: number;
  /** "YYYY-MM-DD" */
  date: string;
  notes: string | null;
  created_at: string;
  /** Values of the organization's own fields (migration 011). */
  custom?: CustomValues | null;
  first_name?: string | null;
  last_name?: string | null;
}

/** Values in the add/edit dialog. Hours stay a string while typing. */
interface FormState {
  name: string;
  /** Bulk mode: one volunteer name per line. */
  names: string;
  bulk: boolean;
  /** Split-name mode: one row per volunteer (exactly one when editing). */
  people: { first: string; last: string }[];
  activity: string;
  hours: string;
  date: string;
  notes: string;
}

type SortKey = "volunteer_name" | "activity" | "hours" | "date";
type SortDir = "asc" | "desc";
type ChartView = "volunteer" | "activity" | "month";

// ===========================================================================
// Constants
// ===========================================================================

/** Table rows per page. */
const PAGE_SIZE = 25;
/** One entry cannot exceed a full day. */
const MAX_HOURS_PER_ENTRY = 24;
/** Supabase returns at most 1000 rows per request by default. */
const FETCH_PAGE_SIZE = 1000;
/** Remembers the "value per hour" between visits. */
const RATE_STORAGE_KEY = "volunteer-hour-value";

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 12 };

// ===========================================================================
// Helpers
// ===========================================================================

/** Local-time "YYYY-MM-DD". toISOString() gives the UTC date, which can be "tomorrow" in the evening. */
const localDateString = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtHours = (n: number) => round2(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
/** Appending T00:00:00 parses as local midnight instead of UTC, avoiding off-by-one-day dates. */
const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString();
const fmtMonth = (ym: string) =>
  new Date(ym + "-01T00:00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" });

/** Trim and collapse repeated spaces, so "Ana  Torres " is stored as "Ana Torres". */
const cleanName = (s: string) => s.trim().replace(/\s+/g, " ");
/** Comparison key that ignores case and spacing, so "ana torres" and "Ana Torres" match. */
const nameKey = (s: string) => cleanName(s).toLowerCase();

const emptyForm = (): FormState => ({
  name: "",
  names: "",
  bulk: false,
  people: [{ first: "", last: "" }],
  activity: "",
  hours: "",
  date: localDateString(),
  notes: "",
});

/**
 * Make sure hours is a real number.
 *
 * Bug in the original: Postgres numeric columns arrive from Supabase as
 * strings ("10.5"). The sort compared them as text, so "10" sorted before
 * "9", and the chart/stat code had to remember Number() everywhere.
 */
const normalizeRow = (r: VolunteerHour): VolunteerHour => ({
  ...r,
  hours: Number(r.hours) || 0,
  // Can be blank when the organization hides the activity field.
  activity: r.activity ?? "",
});

/** Escapes quotes and neutralizes spreadsheet formula injection (=, +, -, @). */
const csvCell = (v: string | number | null | undefined) => {
  if (typeof v === "number") return String(v);
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

/**
 * Download rows as a CSV file.
 * Fixes: the link is added to the page before clicking (Firefox needs this),
 * and the URL is released after a short delay. Revoking it immediately can
 * cancel the download in some browsers.
 */
const downloadCSV = (rows: (string | number | null)[][], filename: string) => {
  const csv = "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"); // BOM keeps Excel happy with UTF-8
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Sum a value per group key. */
const sumBy = <T,>(items: T[], key: (i: T) => string, val: (i: T) => number) => {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + val(i);
  return out;
};

/**
 * List of "YYYY-MM" strings from first to last, inclusive, with no gaps.
 * Used to fill months with zero hours in the chart, so a quiet month shows as
 * an empty bar instead of disappearing (which made trends look smoother than
 * they were).
 */
const monthRange = (first: string, last: string): string[] => {
  const out: string[] = [];
  let [y, m] = first.split("-").map(Number);
  const [ly, lm] = last.split("-").map(Number);
  while ((y < ly || (y === ly && m <= lm)) && out.length < 600) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
};

/**
 * Readable message from anything thrown by a save or delete. Supabase errors
 * are plain objects with a message (not Error instances), so both shapes are
 * handled, and permission errors become plain language (see friendlyWriteError).
 */
const errorMessage = (e: unknown, fallback: string): string =>
  friendlyWriteError(e && typeof e === "object" ? (e as { message?: string; code?: string }) : null, fallback);

/** Read the saved hourly value, ignoring blocked storage. */
const loadSavedRate = (): string => {
  try {
    return localStorage.getItem(RATE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

// ===========================================================================
// Data hook
// ===========================================================================

/**
 * Loads all of the user's volunteer hours.
 *
 * Fixes over the original:
 * - With no user, isLoading stayed true forever (the effect returned early
 *   without ever clearing it), so skeletons never went away.
 * - Only the first 1000 rows were returned. Organizations logging hours for
 *   a few years would silently get incomplete totals. All pages are fetched.
 * - Network failures that throw (rather than return an error) are caught.
 * - Hours are converted to numbers on the way in (see normalizeRow).
 */
function useVolunteerHours(userId: string | undefined) {
  const [records, setRecords] = useState<VolunteerHour[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Changing this number triggers a reload. */
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!userId) {
      setRecords([]);
      setIsLoading(false);
      return;
    }
    let ignore = false; // stops an older request from overwriting newer results

    (async () => {
      try {
        const all: VolunteerHour[] = [];
        for (let from = 0; ; from += FETCH_PAGE_SIZE) {
          const { data, error: fetchError } = await supabase
            .from("volunteer_hours")
            .select("*")
            .order("date", { ascending: false })
            .order("id") // tie-breaker keeps paging stable when many rows share a date
            .range(from, from + FETCH_PAGE_SIZE - 1);
          if (fetchError) throw new Error(fetchError.message);
          all.push(...((data as VolunteerHour[]) ?? []).map(normalizeRow));
          if (!data || data.length < FETCH_PAGE_SIZE) break;
        }
        if (ignore) return;
        setError(null);
        setRecords(all);
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : "Check your connection and try again.");
      } finally {
        if (!ignore) setIsLoading(false);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [userId, nonce]);

  /** Reload quietly (keeps current data on screen while fetching). */
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  /** Reload with the loading skeleton, used by "Try again". */
  const retry = useCallback(() => {
    setIsLoading(true);
    setNonce((n) => n + 1);
  }, []);

  return { records, isLoading, error, reload, retry };
}

// ===========================================================================
// Sortable table header
// ===========================================================================

/**
 * Clickable column header for sorting.
 * Moved out of the page component: defined inside, it was a brand-new
 * component on every render, so React remounted every header each time
 * anything changed (and keyboard focus on a header was lost after clicking).
 * The icon now shows the actual sort direction.
 */
function SortHead({
  k,
  label,
  className,
  sortKey,
  sortDir,
  onSort,
}: {
  k: SortKey;
  label: string;
  className?: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  const Icon = !active ? ArrowUpDown : sortDir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead className={className} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-foreground rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onSort(k)}
      >
        {label} <Icon className={`h-3 w-3 ${active ? "" : "opacity-60"}`} aria-hidden="true" />
      </button>
    </TableHead>
  );
}

// ===========================================================================
// Page
// ===========================================================================

export default function VolunteerHoursPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { records, isLoading, error, reload, retry } = useVolunteerHours(user?.id);
  /** Import window (CSV or Excel). */
  const [showImport, setShowImport] = useState(false);
  /** False for viewers and for read-only organizations; hides add/edit/delete controls. */
  const { canEdit } = useOrganization();
  /** The organization's field names, hidden fields, split names and own fields. */
  const fields = useTrackerFields("volunteer_hours");
  const showActivity = fields.shows("activity");
  const showNotes = fields.shows("notes");

  // ----- Dialog / form -----
  const [showDialog, setShowDialog] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VolunteerHour | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  /** Values of the organization's own fields, applied to every row a save creates. */
  const [customValues, setCustomValues] = useState<CustomValues>({});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  /** Split-name mode: mark blank first/last rows after a save attempt. */
  const [showNameErrors, setShowNameErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VolunteerHour | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // ----- Filters / sorting / paging -----
  const [search, setSearch] = useState("");
  const [volunteerFilter, setVolunteerFilter] = useState("");
  const [activityFilter, setActivityFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [page, setPage] = useState(0);
  const [chartView, setChartView] = useState<ChartView>("volunteer");
  /** Optional dollar value of one volunteer hour, remembered between visits. */
  const [rateStr, setRateStr] = useState(loadSavedRate);

  const today = localDateString();
  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  /** Change one first/last row in split-name mode. */
  const setPerson = (i: number, patch: Partial<FormState["people"][number]>) =>
    setForm((f) => ({ ...f, people: f.people.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));

  // Save the hourly value whenever it changes.
  useEffect(() => {
    try {
      localStorage.setItem(RATE_STORAGE_KEY, rateStr);
    } catch {
      // Not critical.
    }
  }, [rateStr]);

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  /**
   * Distinct volunteer names for the filter and autocomplete.
   * Grouped ignoring case and spacing, so "ana torres" and "Ana Torres" are
   * one entry (the most common spelling is shown).
   */
  const volunteerNames = useMemo(() => {
    const spellings = new Map<string, Map<string, number>>();
    for (const r of records) {
      const key = nameKey(r.volunteer_name);
      const counts = spellings.get(key) ?? new Map<string, number>();
      counts.set(r.volunteer_name, (counts.get(r.volunteer_name) ?? 0) + 1);
      spellings.set(key, counts);
    }
    return Array.from(spellings.values())
      .map((counts) => Array.from(counts).sort((a, b) => b[1] - a[1])[0][0])
      .sort((a, b) => a.localeCompare(b));
  }, [records]);

  const activities = useMemo(
    () => Array.from(new Set(records.map((r) => r.activity))).sort((a, b) => a.localeCompare(b)),
    [records],
  );

  /**
   * Records matching every active filter. Volunteer matching ignores case and spacing.
   * Search covers the visible fields and the organization's own fields; a
   * leftover activity filter is ignored once the activity field is hidden.
   */
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const volunteerKey = volunteerFilter ? nameKey(volunteerFilter) : "";
    const activityOn = showActivity ? activityFilter : "";
    return records.filter((r) => {
      if (volunteerKey && nameKey(r.volunteer_name) !== volunteerKey) return false;
      if (activityOn && r.activity !== activityOn) return false;
      if (from && r.date < from) return false; // ISO date strings compare correctly as text
      if (to && r.date > to) return false;
      if (q) {
        const values = customOf(r);
        const text = [
          r.volunteer_name,
          showActivity ? r.activity : "",
          showNotes ? (r.notes ?? "") : "",
          ...fields.custom.map((f) => formatCustomValue(f, values[f.id])),
        ].join(" ");
        if (!text.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [records, search, volunteerFilter, activityFilter, from, to, showActivity, showNotes, fields.custom]);

  /** Filtered records in the chosen order. Ties fall back to newest first. */
  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const primary =
        sortKey === "hours"
          ? (a.hours - b.hours) * dir
          : String(a[sortKey]).localeCompare(String(b[sortKey]), undefined, { sensitivity: "base" }) * dir;
      return primary || b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at);
    });
  }, [filtered, sortKey, sortDir]);

  // Paging. safePage keeps the page valid after deletes or filter changes.
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Go back to page 1 whenever the filters or sort change.
  useEffect(() => {
    setPage(0);
  }, [search, volunteerFilter, activityFilter, from, to, sortKey, sortDir]);

  /** Headline numbers for the filtered records. */
  const stats = useMemo(() => {
    const monthPrefix = today.slice(0, 7);
    const total = filtered.reduce((s, r) => s + r.hours, 0);
    const month = filtered.filter((r) => r.date.startsWith(monthPrefix)).reduce((s, r) => s + r.hours, 0);
    return {
      total: round2(total),
      month: round2(month),
      // Counted ignoring case and spacing, so one person is not counted twice.
      volunteers: new Set(filtered.map((r) => nameKey(r.volunteer_name))).size,
      entries: filtered.length,
    };
  }, [filtered, today]);

  const rate = parseFloat(rateStr);
  const estimatedValue = Number.isFinite(rate) && rate > 0 ? stats.total * rate : null;

  /** The activity chart is unavailable while the activity field is hidden. */
  const effectiveChartView: ChartView = chartView === "activity" && !showActivity ? "volunteer" : chartView;

  /**
   * Chart rows for the selected view.
   * - Volunteers / Activities: top 10 by hours.
   * - Months: the last 12 months that have data, with gaps filled with 0.
   * Each row keeps the full name for the tooltip and a short label for the axis.
   */
  const chartData = useMemo(() => {
    const toRow = (key: string, fullName: string, hours: number) => ({
      key,
      fullName,
      name: fullName.length > 12 ? fullName.slice(0, 12) + "..." : fullName,
      hours: round2(hours),
    });

    if (effectiveChartView === "month") {
      const byMonth = sumBy(filtered, (r) => r.date.slice(0, 7), (r) => r.hours);
      const keys = Object.keys(byMonth).sort();
      if (!keys.length) return [];
      const months = monthRange(keys[0], keys[keys.length - 1]).slice(-12);
      return months.map((m) => toRow(m, fmtMonth(m), byMonth[m] ?? 0));
    }

    const byKey =
      effectiveChartView === "volunteer"
        ? sumBy(filtered, (r) => cleanName(r.volunteer_name), (r) => r.hours)
        : sumBy(filtered, (r) => r.activity, (r) => r.hours);
    return Object.entries(byKey)
      .map(([k, v]) => toRow(k, k, v))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10);
  }, [filtered, effectiveChartView]);

  /** Taller chart when there are more horizontal bars, so labels do not overlap. */
  const chartHeight = effectiveChartView === "month" ? 208 : Math.max(160, chartData.length * 32 + 40);

  const hasFilters = !!(search || volunteerFilter || (showActivity && activityFilter) || from || to);
  const clearFilters = () => {
    setSearch("");
    setVolunteerFilter("");
    setActivityFilter("");
    setFrom("");
    setTo("");
  };

  // -------------------------------------------------------------------------
  // Form helpers
  // -------------------------------------------------------------------------

  /** Split-name rows in use: always exactly one when editing. */
  const personRows = useMemo(
    () => (editingRecord ? form.people.slice(0, 1) : form.people),
    [editingRecord, form.people],
  );

  /**
   * Volunteers entered in the dialog, with the full name and its first/last parts.
   * Bulk mode splits on new lines only. The original also split on commas,
   * so a name typed as "Lee, Sam" became two volunteers, "Lee" and "Sam".
   * In split-name mode each first/last row is one volunteer.
   * Duplicates are removed ignoring case.
   */
  const enteredPeople = useMemo(() => {
    const raw: { first: string; last: string }[] = fields.splitNames
      ? personRows.map((p) => ({ first: cleanName(p.first), last: cleanName(p.last) }))
      : (form.bulk && !editingRecord ? form.names.split(/\r?\n/) : [form.name]).map((n) => splitName(cleanName(n)));
    const seen = new Set<string>();
    const out: { name: string; first: string; last: string }[] = [];
    for (const p of raw) {
      const name = joinName(p.first, p.last);
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      out.push({ name, ...p });
    }
    return out;
  }, [fields.splitNames, personRows, form.bulk, form.names, form.name, editingRecord]);

  const enteredNames = useMemo(() => enteredPeople.map((p) => p.name), [enteredPeople]);

  /**
   * Existing entries with the same volunteer, activity and date as what is
   * being entered. Shown as a heads-up, since logging the same shift twice is
   * an easy mistake when several people share data entry. Saving is still allowed.
   * With the activity field hidden, volunteer and date are compared.
   */
  const possibleDuplicates = useMemo(() => {
    if (!form.date || (showActivity && !form.activity.trim())) return [];
    const activity = form.activity.trim().toLowerCase();
    const names = new Set(enteredNames.map((n) => n.toLowerCase()));
    return records.filter(
      (r) =>
        r.id !== editingRecord?.id &&
        r.date === form.date &&
        (!showActivity || r.activity.toLowerCase() === activity) &&
        names.has(nameKey(r.volunteer_name)),
    );
  }, [records, form.date, form.activity, enteredNames, editingRecord, showActivity]);

  const resetForm = () => {
    setForm(emptyForm());
    setFormError(null);
    setCustomValues({});
    setCustomErrors({});
    setShowNameErrors(false);
    setEditingRecord(null);
    setShowDialog(false);
  };

  /** Open the dialog with a clean form for new hours. */
  const openCreate = () => {
    setForm(emptyForm());
    setFormError(null);
    setCustomValues({});
    setCustomErrors({});
    setShowNameErrors(false);
    setEditingRecord(null);
    setShowDialog(true);
  };

  /**
   * Open the dialog pre-filled with an existing entry. Entries saved before
   * names were split get their first/last name guessed from the full name.
   */
  const openEdit = (r: VolunteerHour) => {
    setEditingRecord(r);
    setForm({
      ...emptyForm(),
      name: r.volunteer_name,
      people: [
        r.first_name != null || r.last_name != null
          ? { first: r.first_name ?? "", last: r.last_name ?? "" }
          : splitName(r.volunteer_name),
      ],
      activity: r.activity,
      hours: String(r.hours),
      date: r.date,
      notes: r.notes ?? "",
    });
    setFormError(null);
    setCustomValues({ ...customOf(r) });
    setCustomErrors({});
    setShowNameErrors(false);
    setShowDialog(true);
  };

  // -------------------------------------------------------------------------
  // Save
  // -------------------------------------------------------------------------

  /**
   * Validate and save. Creates one row per name in bulk mode (or per
   * first/last row in split-name mode); custom field values apply to every row.
   * Names are cleaned (trimmed, single spaces) and, when they match an
   * existing volunteer ignoring case, use that volunteer's existing spelling
   * so one person does not end up listed under two names. Split names are
   * saved as typed, so the full name always matches its first/last parts.
   * Hidden fields are left out of the payload, so an edit keeps their values.
   */
  const handleSave = async () => {
    if (!user || isSaving) return;
    const h = parseFloat(form.hours);

    if (fields.splitNames && personRows.some((p) => !joinName(p.first, p.last))) {
      setShowNameErrors(true);
      return setFormError(
        personRows.length > 1 ? "Enter a first or last name for each volunteer." : "Enter a first or last name.",
      );
    }
    if (enteredNames.length === 0)
      return setFormError(form.bulk ? "Enter at least one volunteer name." : "Enter the volunteer's name.");
    if (showActivity && !form.activity.trim()) return setFormError(`Enter ${fields.label("activity").toLowerCase()}.`);
    if (!Number.isFinite(h) || h <= 0) return setFormError("Hours must be a number greater than 0.");
    if (h > MAX_HOURS_PER_ENTRY) return setFormError(`An entry can't exceed ${MAX_HOURS_PER_ENTRY} hours.`);
    if (!form.date || form.date > today) return setFormError("Choose a date that is today or earlier.");

    const custom = prepareCustomValues(fields.custom, customValues);
    setCustomErrors(custom.errors);
    if (Object.keys(custom.errors).length > 0) return setFormError("Check the highlighted fields.");

    // Map typed names onto existing spellings where they match (single-name mode).
    const existingByKey = new Map(volunteerNames.map((n) => [nameKey(n), n]));
    const people = fields.splitNames
      ? enteredPeople
      : enteredPeople.map((p) => {
          const name = existingByKey.get(nameKey(p.name)) ?? p.name;
          return { name, ...splitName(name) };
        });
    const existingActivity = activities.find((a) => a.toLowerCase() === form.activity.trim().toLowerCase());

    setFormError(null);
    setIsSaving(true);
    try {
      const base = {
        ...(showActivity ? { activity: existingActivity ?? form.activity.trim() } : {}),
        hours: round2(h),
        date: form.date,
        ...(showNotes ? { notes: form.notes.trim() || null } : {}),
        // Columns from migration 011 are only sent once it has been run.
        ...(fields.isAvailable ? { custom: custom.values } : {}),
      };
      const nameColumns = (p: (typeof people)[number]) => ({
        volunteer_name: p.name,
        ...(fields.isAvailable ? { first_name: p.first || null, last_name: p.last || null } : {}),
      });

      if (editingRecord) {
        const { error: updateError } = await supabase
          .from("volunteer_hours")
          .update({ ...base, ...nameColumns(people[0]) })
          .eq("id", editingRecord.id);
        if (updateError) throw updateError;
        toast({ title: "Entry updated" });
      } else {
        const { error: insertError } = await supabase
          .from("volunteer_hours")
          .insert(people.map((p) => ({ ...base, ...nameColumns(p), user_id: user.id })));
        if (insertError) throw insertError;
        toast({ title: people.length > 1 ? `${people.length} entries logged` : "Hours logged" });
      }
      resetForm();
      reload();
    } catch (e) {
      toast({
        title: "Couldn't save",
        description: errorMessage(e, "Something went wrong. Try again."),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  /**
   * Delete the entry in pendingDelete.
   * Fixes: network failures that throw are now caught, and the dialog stays
   * open with a "Deleting..." state until the request finishes, instead of
   * closing first and failing silently.
   */
  const confirmDelete = async (e: React.MouseEvent) => {
    e.preventDefault(); // keep the AlertDialog open until the request finishes
    if (!pendingDelete || !user || isDeleting) return;
    setIsDeleting(true);
    try {
      const { error: deleteError } = await supabase
        .from("volunteer_hours")
        .delete()
        .eq("id", pendingDelete.id)
      if (deleteError) throw deleteError;
      toast({ title: "Entry deleted" });
      setPendingDelete(null);
      reload();
    } catch (err) {
      toast({
        title: "Couldn't delete",
        description: errorMessage(err, "Try again."),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------

  /** Adds the date range to file names, e.g. volunteer-hours_2026-01-01_to_2026-06-30.csv */
  const rangeLabel = from || to ? `_${from || "start"}_to_${to || today}` : "";

  /** Every filtered entry, in the current sort order. */
  const exportDetail = () => {
    downloadCSV(
      [
        [
          fields.label("volunteer_name"),
          ...(showActivity ? [fields.label("activity")] : []),
          fields.label("hours"),
          fields.label("date"),
          ...(showNotes ? [fields.label("notes")] : []),
          ...fields.custom.map((f) => f.label),
        ],
        ...sorted.map((r) => [
          r.volunteer_name,
          ...(showActivity ? [r.activity] : []),
          r.hours,
          r.date,
          ...(showNotes ? [r.notes ?? ""] : []),
          ...fields.custom.map((f) => formatCustomValue(f, customOf(r)[f.id])),
        ]),
      ],
      `volunteer-hours${rangeLabel}.csv`,
    );
  };

  /** Totals by activity and by volunteer, plus the estimated value if a rate is set. */
  const exportSummary = () => {
    const entries = (key: (r: VolunteerHour) => string) => {
      const hrs = sumBy(filtered, key, (r) => r.hours);
      const cnt = sumBy(filtered, key, () => 1);
      return Object.keys(hrs)
        .sort((a, b) => hrs[b] - hrs[a])
        .map((k) => [k, round2(hrs[k]), cnt[k]] as const);
    };
    const rows: (string | number | null)[][] = [
      ["Report period", `${from || "all time"} to ${to || today}`],
      ["Total hours", stats.total],
      ["Volunteers", stats.volunteers],
      ["Entries", stats.entries],
      ...(estimatedValue !== null
        ? [
            ["Hourly value used", rate],
            ["Estimated value", round2(estimatedValue)],
          ]
        : []),
      [],
      ["Type", "Name", "Hours", "Entries"],
      ...(showActivity ? entries((r) => r.activity).map(([k, h, c]) => [fields.label("activity"), k, h, c]) : []),
      ...entries((r) => cleanName(r.volunteer_name)).map(([k, h, c]) => ["Volunteer", k, h, c]),
    ];
    downloadCSV(rows, `volunteer-summary${rangeLabel}.csv`);
  };

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  /** Click a header: same column flips direction; new column starts with a sensible default. */
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir(key === "hours" || key === "date" ? "desc" : "asc");
    }
  };

  const selectClass =
    "h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const statCards: { label: string; value: string | number }[] = [
    { label: "Total hours", value: fmtHours(stats.total) },
    { label: "This month", value: fmtHours(stats.month) },
    { label: "Volunteers", value: stats.volunteers },
    { label: "Entries", value: stats.entries },
  ];

  const isBulk = !editingRecord && (fields.splitNames ? form.people.length > 1 : form.bulk);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ===== Header ===== */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Volunteer Hours</h1>
          <p className="text-muted-foreground">Track volunteer time for grant applications and impact reports</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Exports use the filtered list, so they are disabled when filters hide everything. */}
          {records.length > 0 && (
            <>
              <Button variant="outline" onClick={exportSummary} disabled={filtered.length === 0}>
                <FileText className="mr-1 h-4 w-4" aria-hidden="true" /> Summary report
              </Button>
              <Button variant="outline" onClick={exportDetail} disabled={filtered.length === 0}>
                <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Export CSV
              </Button>
            </>
          )}
          <CustomizeFieldsButton fields={fields} />
          {canEdit && (
            <>
              <Button variant="outline" onClick={() => setShowImport(true)}>
                <Upload className="mr-1 h-4 w-4" aria-hidden="true" /> Import
              </Button>
              <Button onClick={openCreate}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Log hours
              </Button>
            </>
          )}
        </div>
      </div>
      {showImport && <ImportDialog kind="volunteer_hours" onClose={() => setShowImport(false)} onImported={reload} />}
      <ReadOnlyNotice />

      {/* ===== Load error ===== */}
      {error && (
        <Card role="alert" className="p-4 flex items-center justify-between gap-4 border-destructive/50">
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
            <span>Couldn't load your volunteer hours: {error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={retry}>
            Try again
          </Button>
        </Card>
      )}

      {/* ===== Filters ===== */}
      {records.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 flex-1 min-w-[180px]">
              <Label htmlFor="vh-search" className="text-xs">
                Search
              </Label>
              <Input
                id="vh-search"
                placeholder={showActivity && showNotes ? "Name, activity, or notes" : "Search entries"}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vh-volunteer" className="text-xs">
                {fields.label("volunteer_name")}
              </Label>
              <select
                id="vh-volunteer"
                className={selectClass}
                value={volunteerFilter}
                onChange={(e) => setVolunteerFilter(e.target.value)}
              >
                <option value="">All</option>
                {volunteerNames.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            {showActivity && (
              <div className="space-y-1">
                <Label htmlFor="vh-activity" className="text-xs">
                  {fields.label("activity")}
                </Label>
                <select
                  id="vh-activity"
                  className={selectClass}
                  value={activityFilter}
                  onChange={(e) => setActivityFilter(e.target.value)}
                >
                  <option value="">All</option>
                  {activities.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="vh-from" className="text-xs">
                From
              </Label>
              <Input id="vh-from" type="date" max={to || today} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vh-to" className="text-xs">
                To
              </Label>
              <Input
                id="vh-to"
                type="date"
                min={from || undefined}
                max={today}
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
            {/* Many funders accept volunteer time as an in-kind contribution at a
                published hourly rate; enter the rate your funder uses. */}
            <div className="space-y-1 w-32">
              <Label htmlFor="vh-rate" className="text-xs">
                Value per hour ($)
              </Label>
              <Input
                id="vh-rate"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                placeholder="Optional"
                value={rateStr}
                onChange={(e) => setRateStr(e.target.value)}
                aria-describedby="vh-rate-help"
              />
              <span id="vh-rate-help" className="sr-only">
                Used to estimate the dollar value of volunteer time. Saved for next time.
              </span>
            </div>
            {hasFilters && (
              <Button variant="ghost" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* ===== Stats ===== */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="p-4 text-center">
            {isLoading ? (
              <Skeleton className="h-7 w-16 mx-auto" />
            ) : (
              <p className="text-xl font-bold text-primary">{stat.value}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {stat.label}
              {hasFilters && <span className="sr-only"> (filtered)</span>}
            </p>
          </Card>
        ))}
      </div>
      {hasFilters && !isLoading && (
        <p className="text-xs text-muted-foreground -mt-3">Totals reflect the current filters.</p>
      )}
      {estimatedValue !== null && (
        <p className="text-sm text-muted-foreground -mt-2">
          Estimated value of {fmtHours(stats.total)} hours at ${rate.toFixed(2)}/hr:{" "}
          <span className="font-semibold text-foreground">
            {estimatedValue.toLocaleString(undefined, { style: "currency", currency: "USD" })}
          </span>
        </p>
      )}

      {/* ===== Chart ===== */}
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : chartData.length > 0 ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" aria-hidden="true" />
              {effectiveChartView === "volunteer"
                ? "Top volunteers by hours"
                : effectiveChartView === "activity"
                  ? `Hours by ${fields.label("activity").toLowerCase()}`
                  : "Hours by month"}
            </h2>
            <div className="flex gap-1" role="group" aria-label="Chart view">
              {(
                [
                  ["volunteer", "Volunteers"],
                  ["activity", fields.label("activity")],
                  ["month", "Months"],
                ] as const
              )
                .filter(([v]) => v !== "activity" || showActivity)
                .map(([v, label]) => (
                <Button
                  key={v}
                  size="sm"
                  variant={effectiveChartView === v ? "default" : "outline"}
                  aria-pressed={effectiveChartView === v}
                  onClick={() => setChartView(v)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div style={{ height: chartHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout={effectiveChartView === "month" ? "horizontal" : "vertical"}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                {effectiveChartView === "month" ? (
                  <>
                    <XAxis type="category" dataKey="name" tick={AXIS_TICK} />
                    <YAxis type="number" tick={AXIS_TICK} />
                  </>
                ) : (
                  <>
                    <XAxis type="number" tick={AXIS_TICK} />
                    <YAxis type="category" dataKey="name" width={100} tick={AXIS_TICK} />
                  </>
                )}
                <Tooltip
                  formatter={(v) => [`${fmtHours(Number(v))} hrs`, "Hours"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                    color: "hsl(var(--foreground))",
                  }}
                />
                {/* Theme color instead of a hard-coded blue, so it follows dark mode and branding. */}
                <Bar
                  dataKey="hours"
                  fill="hsl(var(--primary))"
                  radius={effectiveChartView === "month" ? [4, 4, 0, 0] : [0, 4, 4, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      {/* ===== Table (or loading / no matches / empty) ===== */}
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : records.length > 0 ? (
        sorted.length > 0 ? (
          <Card className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead k="volunteer_name" label={fields.label("volunteer_name")} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  {showActivity && (
                    <SortHead k="activity" label={fields.label("activity")} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  )}
                  <SortHead k="hours" label={fields.label("hours")} className="text-right" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortHead k="date" label={fields.label("date")} sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  {showNotes && <TableHead>{fields.label("notes")}</TableHead>}
                  {fields.custom.map((f) => (
                    <TableHead key={f.id}>{f.label}</TableHead>
                  ))}
                  {canEdit && <TableHead className="w-20">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.volunteer_name}</TableCell>
                    {showActivity && (
                      <TableCell>
                        <Badge variant="secondary">{r.activity}</Badge>
                      </TableCell>
                    )}
                    <TableCell className="text-right font-semibold text-primary tabular-nums">{fmtHours(r.hours)}</TableCell>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.date)}</TableCell>
                    {showNotes && (
                      <TableCell className="max-w-[150px] truncate text-muted-foreground" title={r.notes ?? undefined}>
                        {r.notes ?? "-"}
                      </TableCell>
                    )}
                    {fields.custom.map((f) => {
                      const text = formatCustomValue(f, customOf(r)[f.id]);
                      return (
                        <TableCell key={f.id} className="max-w-[150px] truncate" title={text || undefined}>
                          {text || "-"}
                        </TableCell>
                      );
                    })}
                    {canEdit && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Edit entry for ${r.volunteer_name}`}
                            onClick={() => openEdit(r)}
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete entry for ${r.volunteer_name}`}
                            onClick={() => setPendingDelete(r)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            {pageCount > 1 && (
              <nav
                aria-label="Table pages"
                className="flex items-center justify-between gap-2 border-t p-3 text-sm text-muted-foreground"
              >
                <span>
                  {safePage * PAGE_SIZE + 1} to {Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Previous page"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  <span className="px-2" aria-live="polite">
                    Page {safePage + 1} of {pageCount}
                  </span>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Next page"
                    disabled={safePage >= pageCount - 1}
                    onClick={() => setPage(safePage + 1)}
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </nav>
            )}
          </Card>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="font-semibold">No entries match these filters</p>
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        )
      ) : !error ? (
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Clock className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No hours logged yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {canEdit
                ? "Track volunteer time to strengthen grant applications and show your community impact."
                : "Volunteer hours your organization logs will appear here."}
            </p>
          </div>
          {canEdit && (
            <Button onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Log first hours
            </Button>
          )}
        </div>
      ) : null}

      {/* ===== Add / edit dialog ===== */}
      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          // Do not close (and wipe the form) while a save is in progress.
          if (!open && !isSaving) resetForm();
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingRecord ? "Edit hours" : "Log volunteer hours"}</DialogTitle>
          </DialogHeader>

          {/* A real <form> so pressing Enter in a field saves. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
            noValidate
          >
            <div className="space-y-4 py-2">
              {/* Name(s) */}
              {fields.splitNames ? (
                // Split names: one first/last row per volunteer. Extra rows log
                // the same hours for several people (one row when editing).
                <div className="space-y-3">
                  {personRows.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2"
                      role="group"
                      aria-label={personRows.length > 1 ? `Volunteer ${i + 1}` : fields.label("volunteer_name")}
                    >
                      <div className="flex-1">
                        <SplitNameInputs
                          first={p.first}
                          last={p.last}
                          onFirst={(v) => setPerson(i, { first: v })}
                          onLast={(v) => setPerson(i, { last: v })}
                          error={showNameErrors && !joinName(p.first, p.last) ? "Enter a first or last name." : null}
                          idPrefix={`vh-person-${i}`}
                          autoFocus={i === 0 || i === personRows.length - 1}
                        />
                      </div>
                      {i > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="mt-7"
                          aria-label={`Remove volunteer ${i + 1}`}
                          onClick={() => setField("people", form.people.filter((_, j) => j !== i))}
                        >
                          <X className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {!editingRecord && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => setField("people", [...form.people, { first: "", last: "" }])}
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add another volunteer
                    </button>
                  )}
                  {isBulk && enteredNames.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {enteredNames.length} {enteredNames.length === 1 ? "volunteer" : "volunteers"} will be logged.
                    </p>
                  )}
                </div>
              ) : isBulk ? (
                <div className="space-y-2">
                  <Label htmlFor="vh-names">
                    {fields.label("volunteer_name")}{" "}
                    <span className="text-muted-foreground font-normal">(one per line)</span>
                  </Label>
                  <Textarea
                    id="vh-names"
                    rows={5}
                    placeholder={"Ana Torres\nSam Lee\nPriya Patel"}
                    value={form.names}
                    onChange={(e) => setField("names", e.target.value)}
                    autoFocus
                  />
                  {enteredNames.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {enteredNames.length} {enteredNames.length === 1 ? "volunteer" : "volunteers"} will be logged.
                    </p>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="vh-name">{fields.label("volunteer_name")}</Label>
                  <Input
                    id="vh-name"
                    placeholder="Full name"
                    value={form.name}
                    onChange={(e) => setField("name", e.target.value)}
                    list="volunteer-names"
                    maxLength={120}
                    autoComplete="off"
                    autoFocus
                  />
                  <datalist id="volunteer-names">
                    {volunteerNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </div>
              )}

              {/* Bulk toggle (split-name mode uses "Add another volunteer" instead) */}
              {!editingRecord && !fields.splitNames && (
                <button
                  type="button"
                  className="text-sm text-primary underline-offset-4 hover:underline -mt-2 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setField("bulk", !form.bulk)}
                >
                  {form.bulk ? "Log one volunteer instead" : "Log several volunteers for the same activity"}
                </button>
              )}

              {/* Activity (with suggestions) */}
              {showActivity && (
                <div className="space-y-2">
                  <Label htmlFor="vh-act">{fields.label("activity")}</Label>
                  <Input
                    id="vh-act"
                    placeholder="Food distribution, Event setup..."
                    value={form.activity}
                    onChange={(e) => setField("activity", e.target.value)}
                    list="activities"
                    maxLength={100}
                    autoComplete="off"
                  />
                  <datalist id="activities">
                    {activities.map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </div>
              )}

              {/* Hours and date */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="vh-hours">{isBulk ? `${fields.label("hours")} each` : fields.label("hours")}</Label>
                  <Input
                    id="vh-hours"
                    type="number"
                    inputMode="decimal"
                    min="0.25"
                    max={MAX_HOURS_PER_ENTRY}
                    step="0.25"
                    placeholder="2.5"
                    value={form.hours}
                    onChange={(e) => setField("hours", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vh-date">{fields.label("date")}</Label>
                  <Input
                    id="vh-date"
                    type="date"
                    max={today}
                    value={form.date}
                    onChange={(e) => setField("date", e.target.value)}
                  />
                </div>
              </div>

              {/* Notes */}
              {showNotes && (
                <div className="space-y-2">
                  <Label htmlFor="vh-notes">
                    {fields.label("notes")} <span className="text-muted-foreground font-normal">(optional)</span>
                  </Label>
                  <Textarea
                    id="vh-notes"
                    placeholder="Any additional notes..."
                    value={form.notes}
                    onChange={(e) => setField("notes", e.target.value)}
                    maxLength={1000}
                  />
                </div>
              )}

              {/* The organization's own fields (applied to every volunteer logged) */}
              <CustomFieldInputs
                fields={fields.custom}
                values={customValues}
                onChange={setCustomValues}
                errors={customErrors}
                idPrefix="volunteer-custom"
              />

              {/* Possible duplicate entry (warning only) */}
              {possibleDuplicates.length > 0 && (
                <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    {possibleDuplicates.length === 1
                      ? `${possibleDuplicates[0].volunteer_name} already has ${fmtHours(possibleDuplicates[0].hours)} hours logged for this activity on this date.`
                      : `${possibleDuplicates.length} of these volunteers already have hours logged for this activity on this date.`}{" "}
                    You can still save if this is a separate shift.
                  </span>
                </p>
              )}

              {formError && (
                <p role="alert" className="text-sm text-destructive">
                  {formError}
                </p>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" onClick={resetForm} disabled={isSaving}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving
                  ? "Saving..."
                  : editingRecord
                    ? "Save changes"
                    : isBulk && enteredNames.length > 1
                      ? `Log hours for ${enteredNames.length}`
                      : "Log hours"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ===== Delete confirmation ===== */}
      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete &&
                `${fmtHours(pendingDelete.hours)} hours for ${pendingDelete.volunteer_name} on ${fmtDate(pendingDelete.date)} will be permanently removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Deleting..." : "Delete entry"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}