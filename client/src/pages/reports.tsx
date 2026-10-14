/**
 * ReportsPage
 *
 * Reports on the organization's donations, volunteer hours, inventory and
 * form responses, for staff day to day and for boards, donors and grant
 * applications.
 *
 * Tabs:
 *   - Impact overview   headline numbers, trends, goals, restock alerts
 *   - Donations         totals, donors (new, returning, top), goals, campaigns
 *   - Volunteer hours   hours, top volunteers, activities, every session
 *   - Inventory         current stock, categories, restock list
 *   - Form responses    every form at a glance, or one form question by question
 *   - Outcomes          how the people you serve change between check-ins
 *   - Services          help given to people (migration 012): how much, to how
 *                       many people, of what kinds, and its value
 *
 * Funder portals: the "Funder portals" button manages private links to a
 * live, read-only report for funders (components/reports/funder-shares-dialog).
 *
 * Period: one shared filter (This month, Last 30 days, custom dates, ...)
 * for everything except inventory, which is always current. Every number is
 * compared with the previous period (see getPreviousRange). Only the period
 * and the one before it are loaded, not all history.
 *
 * Data: the whole organization's records (Row Level Security limits rows to
 * the signed-in member's organization). Sample records from "Load sample
 * data" are left out.
 *
 * Links: the tab, period and form are kept in the address, e.g.
 * /reports?tab=donations&period=this_month, so a report can be bookmarked
 * or shared with teammates, and the Dashboard links straight to one.
 *
 * Exports: CSV of the data behind the current tab, and a branded printable
 * report (lib/report-pdf.ts) to save as PDF.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Activity,
  AlertTriangle,
  CalendarRange,
  Clock,
  DollarSign,
  Download,
  FileDown,
  FileText,
  HandHeart,
  Info,
  Package,
  Search,
  Share2,
  TrendingUp,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import {
  answerFields,
  buildTimeSeries,
  CHOICE_FIELD_TYPES,
  daysInRange,
  describePeriod,
  downloadCsv,
  endOfDayTimestamp,
  exportFileName,
  fetchAll,
  formatAnswer,
  formatChange,
  formatCount,
  formatCurrency,
  formatDate,
  formatHours,
  getAnswer,
  getPresetRange,
  getPreviousRange,
  getQty,
  getThreshold,
  granularityLabel,
  inRange,
  isLowStock,
  isOutOfStock,
  mediaUrl,
  needsRestock,
  normalizeName,
  percentChange,
  pickGranularity,
  shorten,
  startOfDayTimestamp,
  submittedDate,
  sumBy,
  summarizeChoices,
  summarizeNumbers,
  TEXT_FIELD_TYPES,
  toISODate,
  type DonationRow,
  type Granularity,
  type InventoryRow,
  type PeriodPreset,
  type VolunteerHourRow,
} from "@/lib/report-utils";
import { openPrintableReport, pdfHeading, pdfNote, pdfProgress, pdfStats, pdfTable, type PdfStat } from "@/lib/report-pdf";
import { ChartCard, COLORS, DANGER_COLOR, DonutChart, EmptyChart, RankedBarChart, StatGrid, TimeSeriesChart } from "@/components/reports/report-ui";
import { GoalsCard, goalTiming, useGoals } from "@/components/reports/goals-card";
import { FormReport, FormsOverview, MAX_TABLE_ROWS, fieldsOf } from "@/components/reports/form-report";
import { OutcomesReport } from "@/components/reports/outcomes-report";
import { FunderSharesDialog } from "@/components/reports/funder-shares-dialog";
import { fetchOutcomes, formatScore, improvedPercent, type OutcomeResult } from "@/lib/outcomes";
import type { Form, FormSubmission } from "@/types/database";

// ===========================================================================
// Constants
// ===========================================================================

type ReportType = "impact" | "donations" | "volunteers" | "inventory" | "forms" | "outcomes" | "services";

const REPORT_TYPES: { value: ReportType; label: string; title: string; icon: LucideIcon }[] = [
  { value: "impact", label: "Impact overview", title: "Impact Report", icon: TrendingUp },
  { value: "donations", label: "Donations", title: "Donation Report", icon: DollarSign },
  { value: "volunteers", label: "Volunteer hours", title: "Volunteer Report", icon: Clock },
  { value: "inventory", label: "Inventory", title: "Inventory Report", icon: Package },
  { value: "forms", label: "Form responses", title: "Form Responses Report", icon: FileText },
  { value: "outcomes", label: "Outcomes", title: "Outcomes Report", icon: Activity },
  { value: "services", label: "Help given", title: "Help Given Report", icon: HandHeart },
];

const PERIOD_PRESETS: { value: Exclude<PeriodPreset, "custom">; label: string }[] = [
  { value: "all", label: "All time" },
  { value: "this_month", label: "This month" },
  { value: "last_30", label: "Last 30 days" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
];

/** "All forms" option in the form picker. Radix Select can't use "" as an item value. */
const ALL_FORMS = "__all__";
const TOP_DONORS = 10;

/** A services row with the person's name (migration 012). */
interface ServiceRow {
  id: string;
  person_id: string;
  date: string;
  service_type: string;
  value: number | string | null;
  quantity: number | null;
  /** One person; typed loosely because the client can't tell it isn't a list. */
  person: { full_name: string } | { full_name: string }[] | null;
}

const serviceName = (x: ServiceRow): string => (Array.isArray(x.person) ? x.person[0]?.full_name : x.person?.full_name) ?? "";

/** Submission columns needed only to count the previous period. */
type SubmissionStub = Pick<FormSubmission, "form_id" | "submitted_at">;

// ===========================================================================
// Address (URL) state
// ===========================================================================

interface ViewState {
  tab: ReportType;
  preset: PeriodPreset;
  from: string;
  to: string;
  formId: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read ?tab=&period=&from=&to=&form= so links open the same report. */
const readViewFromUrl = (): ViewState => {
  const p = new URLSearchParams(window.location.search);
  const tab = REPORT_TYPES.some((r) => r.value === p.get("tab")) ? (p.get("tab") as ReportType) : "impact";
  const formId = p.get("form") ?? "";
  const period = p.get("period");
  if (period === "custom") {
    const from = DATE.test(p.get("from") ?? "") ? p.get("from")! : "";
    const to = DATE.test(p.get("to") ?? "") ? p.get("to")! : "";
    return { tab, preset: "custom", from, to, formId };
  }
  const preset = PERIOD_PRESETS.some((x) => x.value === period) ? (period as PeriodPreset) : "this_year";
  return { tab, preset, ...getPresetRange(preset), formId };
};

const writeViewToUrl = (v: ViewState) => {
  const p = new URLSearchParams();
  if (v.tab !== "impact") p.set("tab", v.tab);
  p.set("period", v.preset);
  if (v.preset === "custom") {
    if (v.from) p.set("from", v.from);
    if (v.to) p.set("to", v.to);
  }
  if (v.tab === "forms" && v.formId) p.set("form", v.formId);
  const next = `${window.location.pathname}?${p.toString()}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
};

// ===========================================================================
// Page
// ===========================================================================

export default function ReportsPage() {
  const { user } = useAuth();
  const { organization, branding } = useOrganization();
  const { toast } = useToast();

  // ----- View (kept in the address) -----
  const [initialView] = useState(readViewFromUrl);
  const [reportType, setReportType] = useState<ReportType>(initialView.tab);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>(initialView.preset);
  const [dateFrom, setDateFrom] = useState(initialView.from);
  const [dateTo, setDateTo] = useState(initialView.to);
  const [selectedFormId, setSelectedFormId] = useState(initialView.formId);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    writeViewToUrl({ tab: reportType, preset: periodPreset, from: dateFrom, to: dateTo, formId: selectedFormId });
  }, [reportType, periodPreset, dateFrom, dateTo, selectedFormId]);

  const periodError = dateFrom && dateTo && dateFrom > dateTo ? "The start date is after the end date." : null;
  const previous = useMemo(() => (periodError ? null : getPreviousRange(periodPreset, dateFrom, dateTo)), [periodPreset, dateFrom, dateTo, periodError]);
  const periodLabel = describePeriod(dateFrom, dateTo);
  const compareLabel = previous ? "vs previous period" : undefined;

  // ----- Data -----
  const [forms, setForms] = useState<Form[]>([]);
  const [inventory, setInventory] = useState<InventoryRow[]>([]);
  /** Donations and hours for the period AND the previous period; split below. */
  const [donations, setDonations] = useState<DonationRow[]>([]);
  const [hours, setHours] = useState<VolunteerHourRow[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [previousSubmissions, setPreviousSubmissions] = useState<SubmissionStub[] | null>(null);
  /** Donors who gave before the period started, to tell new donors from returning ones. */
  const [priorDonors, setPriorDonors] = useState<Set<string> | null>(null);
  const [hasSampleData, setHasSampleData] = useState(false);
  /** Help given in the period and the previous one; null until loaded, "missing" before migration 012. */
  const [services, setServices] = useState<ServiceRow[] | "missing">([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const goals = useGoals();
  const [showFunderPortals, setShowFunderPortals] = useState(false);

  /** Outcome results for the period (migration 010), worked out by the database. */
  const [outcomes, setOutcomes] = useState<OutcomeResult[]>([]);
  const [outcomesState, setOutcomesState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  useEffect(() => {
    if (!user || periodError) return;
    let cancelled = false;
    fetchOutcomes(dateFrom, dateTo)
      .then((rows) => {
        if (cancelled) return;
        setOutcomes(rows);
        setOutcomesState("ready");
      })
      .catch((err: { code?: string }) => {
        if (cancelled) return;
        setOutcomes([]);
        setOutcomesState(["PGRST202", "42883", "PGRST205"].includes(err?.code ?? "") ? "missing" : "error");
      });
    return () => {
      cancelled = true;
    };
  }, [user, dateFrom, dateTo, periodError]);

  /** Forms and inventory don't depend on the period. Sample records are left out. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const failed: string[] = [];
      const [formsRes, inventoryRes, sampleRes] = await Promise.allSettled([
        fetchAll<Form>((f, t) => supabase.from("forms").select("*").eq("is_sample", false).order("created_at").order("id").range(f, t)),
        fetchAll<InventoryRow>((f, t) =>
          supabase.from("inventory_items").select("*").eq("is_sample", false).order("name").order("id").range(f, t),
        ),
        supabase.rpc("sample_data_status"),
      ]);
      if (cancelled) return;
      if (formsRes.status === "fulfilled") setForms(formsRes.value);
      else failed.push("forms");
      if (inventoryRes.status === "fulfilled") setInventory(inventoryRes.value);
      else failed.push("inventory");
      setHasSampleData(sampleRes.status === "fulfilled" && sampleRes.value.data === "sample");
      if (failed.length) {
        toast({ title: "Some report data couldn't be loaded", description: `Missing: ${failed.join(", ")}. Refresh to try again.`, variant: "destructive" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, toast]);

  /** Donations, hours and responses for the period plus the previous one. */
  const fetchFrom = previous?.from ?? dateFrom;
  useEffect(() => {
    if (!user || periodError) return;
    let cancelled = false;
    setIsRefreshing(true);

    (async () => {
      const failed: string[] = [];
      const dated = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q): Q => {
        let out = q;
        if (fetchFrom) out = out.gte("date", fetchFrom);
        if (dateTo) out = out.lte("date", dateTo);
        return out;
      };
      const servicesPromise = fetchAll<ServiceRow>((f, t) =>
        dated(supabase.from("services").select("id, person_id, date, service_type, value, quantity, person:people(full_name)"))
          .order("date")
          .order("id")
          .range(f, t),
      );
      const [donationsRes, hoursRes, subsRes, prevSubsRes, priorRes, servicesRes] = await Promise.allSettled([
        fetchAll<DonationRow>((f, t) =>
          dated(supabase.from("donations").select("*").eq("is_sample", false)).order("date").order("id").range(f, t),
        ),
        fetchAll<VolunteerHourRow>((f, t) =>
          dated(supabase.from("volunteer_hours").select("*").eq("is_sample", false)).order("date").order("id").range(f, t),
        ),
        fetchAll<FormSubmission>((f, t) => {
          let q = supabase.from("form_submissions").select("*");
          if (dateFrom) q = q.gte("submitted_at", startOfDayTimestamp(dateFrom));
          if (dateTo) q = q.lt("submitted_at", endOfDayTimestamp(dateTo));
          return q.order("submitted_at", { ascending: false }).order("id").range(f, t);
        }),
        previous
          ? fetchAll<SubmissionStub>((f, t) =>
              supabase
                .from("form_submissions")
                .select("form_id, submitted_at")
                .gte("submitted_at", startOfDayTimestamp(previous.from))
                .lt("submitted_at", endOfDayTimestamp(previous.to))
                .order("id")
                .range(f, t),
            )
          : Promise.resolve(null),
        dateFrom
          ? fetchAll<{ donor_name: string }>((f, t) =>
              supabase.from("donations").select("donor_name").eq("is_sample", false).lt("date", dateFrom).order("id").range(f, t),
            )
          : Promise.resolve(null),
        servicesPromise,
      ]);
      if (cancelled) return;

      if (donationsRes.status === "fulfilled") setDonations(donationsRes.value);
      else failed.push("donations");
      if (hoursRes.status === "fulfilled") setHours(hoursRes.value);
      else failed.push("volunteer hours");
      if (subsRes.status === "fulfilled") setSubmissions(subsRes.value);
      else failed.push("form responses");
      // Before migration 012 there's no services table; the tab explains that instead of a toast.
      if (servicesRes.status === "fulfilled") setServices(servicesRes.value);
      else setServices(/services|schema cache/i.test(String(servicesRes.reason?.message)) ? "missing" : []);
      setPreviousSubmissions(prevSubsRes.status === "fulfilled" ? prevSubsRes.value : null);
      setPriorDonors(
        priorRes.status === "fulfilled" && priorRes.value ? new Set(priorRes.value.map((d) => normalizeName(d.donor_name))) : null,
      );
      setIsLoading(false);
      setIsRefreshing(false);
      if (failed.length) {
        toast({
          title: "Some report data couldn't be loaded",
          description: `Missing: ${failed.join(", ")}. Totals may be incomplete. Refresh to try again.`,
          variant: "destructive",
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `previous` is derived from these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, fetchFrom, dateFrom, dateTo, periodError, toast]);

  // -------------------------------------------------------------------------
  // Period controls
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Shared derived values
  // -------------------------------------------------------------------------

  const formsById = useMemo(() => new Map(forms.map((f) => [f.id, f])), [forms]);

  const inPeriod = useCallback((iso: string) => inRange(iso, dateFrom, dateTo), [dateFrom, dateTo]);
  const inPrevious = useCallback((iso: string) => Boolean(previous) && inRange(iso, previous!.from, previous!.to), [previous]);

  const periodDonations = useMemo(() => donations.filter((d) => inPeriod(d.date)), [donations, inPeriod]);
  const prevDonations = useMemo(() => (previous ? donations.filter((d) => inPrevious(d.date)) : null), [donations, inPrevious, previous]);
  const periodHours = useMemo(() => hours.filter((v) => inPeriod(v.date)), [hours, inPeriod]);
  const prevHours = useMemo(() => (previous ? hours.filter((v) => inPrevious(v.date)) : null), [hours, inPrevious, previous]);
  /** Responses to forms in this organization's real (non-sample) forms. */
  const periodSubmissions = useMemo(() => submissions.filter((s) => formsById.has(s.form_id)), [submissions, formsById]);
  const prevSubmissions = useMemo(
    () => (previousSubmissions ? previousSubmissions.filter((s) => formsById.has(s.form_id)) : null),
    [previousSubmissions, formsById],
  );

  /** The range charts cover: the period, or for "All time" the span of the data. */
  const chartRange = useMemo(() => {
    if (dateFrom && dateTo) return { from: dateFrom, to: dateTo };
    const dates = [...periodDonations.map((d) => d.date), ...periodHours.map((v) => v.date), ...periodSubmissions.map(submittedDate)]
      .filter(Boolean)
      .sort();
    if (!dates.length) return undefined;
    return { from: dateFrom || dates[0], to: dateTo || toISODate(new Date()) };
  }, [dateFrom, dateTo, periodDonations, periodHours, periodSubmissions]);
  const granularity: Granularity = chartRange ? pickGranularity(chartRange.from, chartRange.to) : "month";

  // -------------------------------------------------------------------------
  // Donations
  // -------------------------------------------------------------------------

  const donationStats = useMemo(() => {
    const summarize = (rows: DonationRow[]) => {
      const total = rows.reduce((s, d) => s + Number(d.amount), 0);
      const donors = new Set(rows.map((d) => normalizeName(d.donor_name)));
      return { total, count: rows.length, donors: donors.size, average: rows.length ? total / rows.length : 0 };
    };
    const current = summarize(periodDonations);
    const prev = prevDonations ? summarize(prevDonations) : null;

    // Per donor: total, gifts, last gift, and the spelling used most recently.
    const byDonor = new Map<string, { name: string; total: number; gifts: number; last: string }>();
    for (const d of periodDonations) {
      const key = normalizeName(d.donor_name);
      const row = byDonor.get(key) ?? { name: d.donor_name.trim(), total: 0, gifts: 0, last: "" };
      row.total += Number(d.amount);
      row.gifts += 1;
      if (d.date >= row.last) {
        row.last = d.date;
        row.name = d.donor_name.trim();
      }
      byDonor.set(key, row);
    }
    const donorRows = Array.from(byDonor, ([key, v]) => ({ key, ...v, isNew: priorDonors ? !priorDonors.has(key) : null })).sort(
      (a, b) => b.total - a.total,
    );
    const newDonors = priorDonors ? donorRows.filter((d) => d.isNew).length : null;

    return {
      ...current,
      prev,
      newDonors,
      returningDonors: newDonors == null ? null : donorRows.length - newDonors,
      repeatDonors: donorRows.filter((d) => d.gifts > 1).length,
      topDonors: donorRows.slice(0, TOP_DONORS),
      series: buildTimeSeries(periodDonations.map((d) => ({ date: d.date, value: Number(d.amount) })), granularity, chartRange),
      byCampaign: sumBy(periodDonations, (d) => d.campaign?.trim() || "General", (d) => Number(d.amount)),
      byMethod: sumBy(periodDonations, (d) => d.payment_method?.trim() || "Unknown", () => 1),
    };
  }, [periodDonations, prevDonations, priorDonors, granularity, chartRange]);

  const donationsNewestFirst = useMemo(
    () => [...periodDonations].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    [periodDonations],
  );

  /** Every campaign name used, suggested when adding a goal. */
  const campaignNames = useMemo(
    () => Array.from(new Set(donations.map((d) => d.campaign?.trim()).filter((c): c is string => Boolean(c)))).sort(),
    [donations],
  );

  // -------------------------------------------------------------------------
  // Volunteer hours
  // -------------------------------------------------------------------------

  const volunteerStats = useMemo(() => {
    const summarize = (rows: VolunteerHourRow[]) => {
      const total = rows.reduce((s, v) => s + Number(v.hours), 0);
      return {
        totalHours: total,
        volunteers: new Set(rows.map((v) => normalizeName(v.volunteer_name))).size,
        sessions: rows.length,
        average: rows.length ? total / rows.length : 0,
      };
    };
    const byVolunteer = sumBy(periodHours, (v) => v.volunteer_name.trim(), (v) => Number(v.hours));
    return {
      ...summarize(periodHours),
      prev: prevHours ? summarize(prevHours) : null,
      allVolunteers: byVolunteer,
      top: byVolunteer.slice(0, 10).map((v) => ({ label: shorten(v.name, 16), fullName: v.name, value: v.value })),
      byActivity: sumBy(periodHours, (v) => v.activity?.trim() || "Other", (v) => Number(v.hours)),
      series: buildTimeSeries(periodHours.map((v) => ({ date: v.date, value: Number(v.hours) })), granularity, chartRange),
      newestFirst: [...periodHours].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    };
  }, [periodHours, prevHours, granularity, chartRange]);

  // -------------------------------------------------------------------------
  // Help given (services)
  // -------------------------------------------------------------------------

  const serviceStats = useMemo(() => {
    const rows = services === "missing" ? [] : services;
    const summarize = (list: ServiceRow[]) => {
      const value = list.reduce((sum, x) => sum + (Number(x.value) || 0), 0);
      const people = new Set(list.map((x) => x.person_id)).size;
      return { count: list.length, people, value, perPerson: people ? value / people : 0 };
    };
    const current = rows.filter((x) => inPeriod(x.date));
    const prev = previous ? rows.filter((x) => inPrevious(x.date)) : null;
    return {
      ...summarize(current),
      prev: prev ? summarize(prev) : null,
      byType: sumBy(current, (x) => x.service_type.trim(), () => 1),
      valueByType: sumBy(current.filter((x) => Number(x.value) > 0), (x) => x.service_type.trim(), (x) => Number(x.value) || 0),
      series: buildTimeSeries(current.map((x) => ({ date: x.date, value: 1 })), granularity, chartRange),
      newestFirst: [...current].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    };
  }, [services, inPeriod, inPrevious, previous, granularity, chartRange]);

  // -------------------------------------------------------------------------
  // Inventory (current snapshot; the period doesn't apply)
  // -------------------------------------------------------------------------

  const inventoryStats = useMemo(() => {
    const restock = inventory.filter(needsRestock).sort((a, b) => getQty(a) / getThreshold(a) - getQty(b) / getThreshold(b));
    return {
      total: inventory.length,
      units: inventory.reduce((s, i) => s + getQty(i), 0),
      low: inventory.filter(isLowStock).length,
      out: inventory.filter(isOutOfStock).length,
      restock,
      byCategory: sumBy(inventory, (i) => i.category?.trim() || "Uncategorized", () => 1),
      // Lowest stock first, relative to each item's own restock level.
      lowest: [...inventory]
        .sort((a, b) => getQty(a) / Math.max(getThreshold(a), 1) - getQty(b) / Math.max(getThreshold(b), 1))
        .slice(0, 15)
        .map((i) => ({
          label: shorten(i.name, 16),
          fullName: `${i.name} (restock at ${getThreshold(i)})`,
          value: getQty(i),
          color: needsRestock(i) ? DANGER_COLOR : COLORS[0],
        })),
    };
  }, [inventory]);

  // -------------------------------------------------------------------------
  // Forms
  // -------------------------------------------------------------------------

  const selectedForm = selectedFormId ? formsById.get(selectedFormId) : undefined;
  const formSubmissions = useMemo(
    () => (selectedForm ? periodSubmissions.filter((s) => s.form_id === selectedForm.id) : []),
    [periodSubmissions, selectedForm],
  );
  const filteredSubmissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return formSubmissions;
    return formSubmissions.filter((s) =>
      Object.values((s.data as Record<string, unknown>) ?? {}).some((v) => formatAnswer(v).toLowerCase().includes(q)),
    );
  }, [formSubmissions, searchQuery]);
  const previousFormCounts = useMemo(() => {
    if (!prevSubmissions) return null;
    const m = new Map<string, number>();
    for (const s of prevSubmissions) m.set(s.form_id, (m.get(s.form_id) ?? 0) + 1);
    return m;
  }, [prevSubmissions]);

  /** Last 7 days and latest response for the selected form, whatever the period. */
  const [recent, setRecent] = useState<{ last7: number | null; latest: string | null }>({ last7: null, latest: null });
  useEffect(() => {
    if (!selectedForm) return;
    let cancelled = false;
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
    Promise.all([
      supabase.from("form_submissions").select("id", { count: "exact", head: true }).eq("form_id", selectedForm.id).gte("submitted_at", weekAgo),
      supabase.from("form_submissions").select("submitted_at").eq("form_id", selectedForm.id).order("submitted_at", { ascending: false }).limit(1),
    ]).then(([countRes, latestRes]) => {
      if (cancelled) return;
      setRecent({ last7: countRes.count ?? null, latest: latestRes.data?.[0]?.submitted_at ?? null });
    });
    return () => {
      cancelled = true;
    };
  }, [selectedForm]);

  const selectForm = (value: string) => {
    setSelectedFormId(value === ALL_FORMS ? "" : value);
    setSearchQuery("");
  };

  // Forms in the picker: active first, then archived.
  const pickerForms = useMemo(
    () => [...forms].sort((a, b) => Number(a.is_archived) - Number(b.is_archived) || a.title.localeCompare(b.title)),
    [forms],
  );

  // -------------------------------------------------------------------------
  // Highlights (plain-language summary for the printed report)
  // -------------------------------------------------------------------------

  const changeWords = (current: number, prev: number | null | undefined) => {
    const c = percentChange(current, prev);
    if (c == null || Math.round(c * 100) === 0) return "";
    return `, ${c > 0 ? "up" : "down"} ${Math.abs(Math.round(c * 100))}% from the previous period`;
  };
  const periodIntro = dateFrom && dateTo ? `From ${formatDate(dateFrom)} to ${formatDate(dateTo)}` : dateFrom ? `Since ${formatDate(dateFrom)}` : "To date";

  const highlights = (): string[] => {
    const lines: string[] = [];
    const d = donationStats;
    const v = volunteerStats;
    if (reportType === "impact" || reportType === "donations") {
      lines.push(
        d.count
          ? `${periodIntro}, ${formatCount(d.donors)} ${d.donors === 1 ? "donor" : "donors"} gave ${formatCurrency(d.total)} across ${formatCount(d.count)} ${
              d.count === 1 ? "gift" : "gifts"
            }${changeWords(d.total, d.prev?.total)}.`
          : `${periodIntro}, no donations were recorded.`,
      );
      if (d.newDonors) lines.push(`${formatCount(d.newDonors)} of them gave for the first time.`);
    }
    if (reportType === "impact" || reportType === "volunteers") {
      lines.push(
        v.sessions
          ? `${formatCount(v.volunteers)} ${v.volunteers === 1 ? "volunteer" : "volunteers"} contributed ${formatHours(v.totalHours)} hours over ${formatCount(
              v.sessions,
            )} ${v.sessions === 1 ? "session" : "sessions"}${changeWords(v.totalHours, v.prev?.totalHours)}.`
          : `No volunteer hours were logged${dateFrom ? " in this period" : ""}.`,
      );
    }
    if (reportType === "impact") {
      lines.push(`${formatCount(periodSubmissions.length)} form ${periodSubmissions.length === 1 ? "response was" : "responses were"} received${changeWords(periodSubmissions.length, prevSubmissions?.length)}.`);
      if (inventoryStats.restock.length) lines.push(`${formatCount(inventoryStats.restock.length)} inventory items need restocking.`);
    }
    if ((reportType === "impact" || reportType === "donations") && goals.status === "ready") {
      const today = toISODate(new Date());
      for (const g of goals.goals.filter((x) => x.start_date <= today && today <= x.end_date).slice(0, 3)) {
        lines.push(`Goal "${g.name}": ${formatCurrency(g.raised)} of ${formatCurrency(g.target_amount)} raised (${Math.round((g.raised / g.target_amount) * 100)}%), ${goalTiming(g).toLowerCase()}.`);
      }
    }
    if ((reportType === "impact" || reportType === "services") && services !== "missing") {
      const sv = serviceStats;
      if (sv.count) {
        lines.push(
          `${periodIntro}, ${formatCount(sv.people)} ${sv.people === 1 ? "person was" : "people were"} helped ${formatCount(sv.count)} ${sv.count === 1 ? "time" : "times"}${
            sv.value ? `, worth ${formatCurrency(sv.value)} in total` : ""
          }${changeWords(sv.count, sv.prev?.count)}.`,
        );
        if (reportType === "services" && sv.byType.length) {
          lines.push(`Most common: ${sv.byType.slice(0, 3).map((t) => `${t.name} (${formatCount(t.value)})`).join(", ")}.`);
        }
      } else if (reportType === "services") {
        lines.push(`${periodIntro}, no help was recorded.`);
      }
    }
    if (reportType === "impact" || reportType === "outcomes") {
      for (const o of outcomes.filter((x) => x.people_with_followup > 0).slice(0, reportType === "impact" ? 2 : 6)) {
        lines.push(
          `"${o.label}": of ${formatCount(o.people_with_followup)} ${o.people_with_followup === 1 ? "person" : "people"} measured more than once, ${improvedPercent(o)}% improved (average ${formatScore(o, o.average_first)} at first, ${formatScore(o, o.average_latest)} at the latest check-in).`,
        );
      }
      if (reportType === "outcomes" && !lines.length) lines.push("No one has been measured more than once yet in this period.");
    }
    if (reportType === "inventory") {
      lines.push(
        `${formatCount(inventoryStats.total)} items are tracked across ${formatCount(inventoryStats.byCategory.length)} ${
          inventoryStats.byCategory.length === 1 ? "category" : "categories"
        }. ${inventoryStats.out ? `${formatCount(inventoryStats.out)} are out of stock and ` : ""}${formatCount(inventoryStats.low)} are running low.`,
      );
    }
    if (reportType === "forms") {
      if (selectedForm) {
        lines.push(`${periodIntro}, "${selectedForm.title}" received ${formatCount(filteredSubmissions.length)} ${filteredSubmissions.length === 1 ? "response" : "responses"}${searchQuery.trim() ? ` matching "${searchQuery.trim()}"` : changeWords(formSubmissions.length, previousFormCounts?.get(selectedForm.id))}.`);
      } else {
        lines.push(`${periodIntro}, your forms received ${formatCount(periodSubmissions.length)} responses${changeWords(periodSubmissions.length, prevSubmissions?.length)}.`);
      }
    }
    return lines;
  };

  // -------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------

  const orgName = organization?.name ?? "Your organization";
  const tabInfo = REPORT_TYPES.find((r) => r.value === reportType)!;
  const panelRef = useRef<HTMLDivElement>(null);

  const canExport =
    !periodError &&
    (reportType === "impact" ||
      (reportType === "donations" && periodDonations.length > 0) ||
      (reportType === "volunteers" && periodHours.length > 0) ||
      (reportType === "inventory" && inventory.length > 0) ||
      (reportType === "forms" && (selectedForm ? filteredSubmissions.length > 0 : forms.length > 0)) ||
      (reportType === "outcomes" && outcomes.length > 0) ||
      (reportType === "services" && serviceStats.count > 0));

  const exportCSV = () => {
    if (!canExport) return;
    let rows: unknown[][] = [];
    const vsPrev = (cur: number, prev: number | null | undefined) => {
      const c = percentChange(cur, prev);
      return c == null ? "" : formatChange(c);
    };
    switch (reportType) {
      case "impact":
        rows = [
          ["Organization", orgName],
          ["Report period", periodLabel],
          ...(previous ? [["Compared with", describePeriod(previous.from, previous.to)]] : []),
          [],
          ["Metric", "This period", ...(previous ? ["Previous period", "Change"] : [])],
          ["Total raised", donationStats.total.toFixed(2), ...(previous ? [donationStats.prev?.total.toFixed(2), vsPrev(donationStats.total, donationStats.prev?.total)] : [])],
          ["Donations", donationStats.count, ...(previous ? [donationStats.prev?.count, vsPrev(donationStats.count, donationStats.prev?.count)] : [])],
          ["Donors", donationStats.donors, ...(previous ? [donationStats.prev?.donors, vsPrev(donationStats.donors, donationStats.prev?.donors)] : [])],
          ["Volunteer hours", formatHours(volunteerStats.totalHours), ...(previous ? [formatHours(volunteerStats.prev?.totalHours ?? 0), vsPrev(volunteerStats.totalHours, volunteerStats.prev?.totalHours)] : [])],
          ["Volunteers", volunteerStats.volunteers, ...(previous ? [volunteerStats.prev?.volunteers, vsPrev(volunteerStats.volunteers, volunteerStats.prev?.volunteers)] : [])],
          ["Form responses", periodSubmissions.length, ...(previous ? [prevSubmissions?.length ?? "", vsPrev(periodSubmissions.length, prevSubmissions?.length)] : [])],
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
          ...donationsNewestFirst.map((d) => [d.donor_name, Number(d.amount).toFixed(2), d.date, d.campaign ?? "", d.payment_method ?? "", d.notes ?? ""]),
        ];
        break;
      case "volunteers":
        rows = [
          ["Volunteer", "Activity", "Hours", "Date", "Notes"],
          ...volunteerStats.newestFirst.map((v) => [v.volunteer_name, v.activity ?? "", Number(v.hours), v.date, v.notes ?? ""]),
        ];
        break;
      case "inventory":
        rows = [
          ["Name", "Category", "Quantity", "Unit", "Condition", "Location", "Restock At", "Status"],
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
        if (selectedForm) {
          const fields = fieldsOf(selectedForm);
          rows = [
            ["Submitted At", ...fields.map((f) => f.label)],
            ...filteredSubmissions.map((s) => [
              s.submitted_at ? new Date(s.submitted_at).toLocaleString("en-US") : "",
              ...fields.map((f) => formatAnswer(getAnswer(s, f.id))),
            ]),
          ];
        } else {
          const counts = new Map<string, number>();
          for (const s of periodSubmissions) counts.set(s.form_id, (counts.get(s.form_id) ?? 0) + 1);
          rows = [
            ["Form", "Status", "Responses", ...(previousFormCounts ? ["Previous period", "Change"] : [])],
            ...pickerForms.map((f) => [
              f.title,
              f.is_archived ? "Archived" : f.is_published ? "Published" : "Draft",
              counts.get(f.id) ?? 0,
              ...(previousFormCounts ? [previousFormCounts.get(f.id) ?? 0, vsPrev(counts.get(f.id) ?? 0, previousFormCounts.get(f.id) ?? 0)] : []),
            ]),
          ];
        }
        break;
    }
    if (reportType === "outcomes") {
      rows = [
        ["Report period", periodLabel],
        [],
        ["Question", "Form", "Better when", "People measured", "Measured more than once", "Average first", "Average latest", "Improved", "No change", "Declined", "Improved %"],
        ...outcomes.map((o) => [
          o.label,
          o.form_title,
          o.better_when,
          o.people_measured,
          o.people_with_followup,
          o.average_first ?? "",
          o.average_latest ?? "",
          o.improved,
          o.same,
          o.worse,
          improvedPercent(o) ?? "",
        ]),
      ];
    }
    if (reportType === "services") {
      rows = [
        ["Date", "Person", "Help given", "Value", "Quantity from inventory"],
        ...serviceStats.newestFirst.map((x) => [x.date, serviceName(x), x.service_type, x.value == null ? "" : Number(x.value).toFixed(2), x.quantity ?? ""]),
      ];
    }
    const label = reportType === "forms" && selectedForm ? `form ${selectedForm.title}` : reportType;
    downloadCsv(exportFileName([orgName, label], "csv"), rows);
  };

  const exportPDF = () => {
    if (!canExport) return;
    const stat = (label: string, value: string, cur?: number, prev?: number | null): PdfStat => {
      const c = cur == null ? null : percentChange(cur, prev);
      return { label, value, change: c == null || !previous ? null : `${formatChange(c)} vs previous period` };
    };
    const goalsHtml = () => {
      if (goals.status !== "ready" || !goals.goals.length) return "";
      return (
        pdfHeading("Fundraising goals") +
        goals.goals
          .map((g) =>
            pdfProgress(
              g.name + (g.campaign ? ` (${g.campaign})` : ""),
              `${formatCurrency(g.raised)} of ${formatCurrency(g.target_amount)} · ${Math.round((g.raised / g.target_amount) * 100)}% · ${goalTiming(g)}`,
              (g.raised / g.target_amount) * 100,
              branding.primaryColor ?? "",
            ),
          )
          .join("")
      );
    };

    let body = "";
    const d = donationStats;
    const v = volunteerStats;
    switch (reportType) {
      case "impact":
        body =
          pdfStats([
            stat("Total raised", formatCurrency(d.total), d.total, d.prev?.total),
            stat("Volunteer hours", formatHours(v.totalHours), v.totalHours, v.prev?.totalHours),
            stat("Form responses", formatCount(periodSubmissions.length), periodSubmissions.length, prevSubmissions?.length),
            stat("Donors", formatCount(d.donors), d.donors, d.prev?.donors),
          ]) +
          goalsHtml() +
          pdfHeading("Donations by campaign") +
          pdfTable(["Campaign", "Total"], d.byCampaign.map((c) => [c.name, formatCurrency(c.value)])) +
          pdfHeading("Top volunteers") +
          pdfTable(["Volunteer", "Hours"], v.allVolunteers.slice(0, 15).map((x) => [x.name, formatHours(x.value)])) +
          (inventoryStats.restock.length
            ? pdfHeading("Items needing restock") +
              pdfTable(["Item", "Quantity", "Restock at"], inventoryStats.restock.map((i) => [i.name, `${getQty(i)} ${i.unit ?? ""}`.trim(), getThreshold(i)]))
            : "");
        break;
      case "donations":
        body =
          pdfStats([
            stat("Total raised", formatCurrency(d.total), d.total, d.prev?.total),
            stat("Gifts", formatCount(d.count), d.count, d.prev?.count),
            stat("Donors", formatCount(d.donors), d.donors, d.prev?.donors),
            stat("Average gift", formatCurrency(d.average), d.average, d.prev?.average),
          ]) +
          pdfStats([
            ...(d.newDonors != null ? [{ label: "New donors", value: formatCount(d.newDonors) }, { label: "Returning donors", value: formatCount(d.returningDonors ?? 0) }] : []),
            { label: "Gave more than once", value: formatCount(d.repeatDonors) },
          ]) +
          goalsHtml() +
          pdfHeading("Top donors") +
          pdfTable(
            ["Donor", "Total", "Gifts", "Latest gift"],
            d.topDonors.map((x) => [x.name + (x.isNew ? " (new)" : ""), formatCurrency(x.total), x.gifts, formatDate(x.last)]),
          ) +
          pdfHeading("By campaign") +
          pdfTable(["Campaign", "Total"], d.byCampaign.map((c) => [c.name, formatCurrency(c.value)])) +
          pdfHeading("All donations") +
          pdfTable(
            ["Donor", "Amount", "Date", "Campaign", "Method"],
            donationsNewestFirst.map((x) => [x.donor_name, formatCurrency(Number(x.amount)), formatDate(x.date), x.campaign ?? "-", x.payment_method ?? "-"]),
          );
        break;
      case "volunteers":
        body =
          pdfStats([
            stat("Total hours", formatHours(v.totalHours), v.totalHours, v.prev?.totalHours),
            stat("Volunteers", formatCount(v.volunteers), v.volunteers, v.prev?.volunteers),
            stat("Sessions", formatCount(v.sessions), v.sessions, v.prev?.sessions),
            stat("Average session", `${formatHours(v.average)} hrs`, v.average, v.prev?.average),
          ]) +
          pdfHeading("Hours by volunteer") +
          pdfTable(["Volunteer", "Hours"], v.allVolunteers.map((x) => [x.name, formatHours(x.value)])) +
          pdfHeading("Hours by activity") +
          pdfTable(["Activity", "Hours"], v.byActivity.map((x) => [x.name, formatHours(x.value)])) +
          pdfHeading("All sessions") +
          pdfTable(["Volunteer", "Activity", "Hours", "Date"], v.newestFirst.map((x) => [x.volunteer_name, x.activity ?? "-", formatHours(Number(x.hours)), formatDate(x.date)]));
        break;
      case "inventory":
        body =
          pdfStats([
            { label: "Items", value: formatCount(inventoryStats.total) },
            { label: "Low stock", value: formatCount(inventoryStats.low) },
            { label: "Out of stock", value: formatCount(inventoryStats.out) },
            { label: "Categories", value: formatCount(inventoryStats.byCategory.length) },
          ]) +
          (inventoryStats.restock.length
            ? pdfHeading("Needs restocking") +
              pdfTable(["Item", "Quantity", "Restock at", "Location"], inventoryStats.restock.map((i) => [i.name, `${getQty(i)} ${i.unit ?? ""}`.trim(), getThreshold(i), i.location ?? "-"]))
            : "") +
          pdfHeading("All inventory") +
          pdfTable(
            ["Item", "Category", "Qty", "Unit", "Condition", "Location"],
            inventory.map((i) => [i.name, i.category ?? "-", getQty(i), i.unit ?? "-", i.condition ?? "-", i.location ?? "-"]),
            (idx) => needsRestock(inventory[idx]),
          );
        break;
      case "forms":
        if (selectedForm) {
          const fields = answerFields(fieldsOf(selectedForm));
          const subs = filteredSubmissions;
          const summaries = fields
            .map((f) => {
              if (CHOICE_FIELD_TYPES.has(f.type)) {
                const counts = summarizeChoices(f, subs);
                const total = counts.reduce((s, c) => s + c.value, 0);
                return pdfHeading(f.label) + pdfTable(["Answer", "Responses", "Share"], counts.map((c) => [c.name, c.value, `${total ? Math.round((c.value / total) * 100) : 0}%`]));
              }
              if (f.type === "number") {
                const n = summarizeNumbers(f, subs);
                const fmt = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-US");
                return n
                  ? pdfHeading(f.label) +
                      pdfStats([
                        { label: "Average", value: fmt(n.avg) },
                        { label: "Total", value: fmt(n.sum) },
                        { label: "Lowest", value: fmt(n.min) },
                        { label: "Highest", value: fmt(n.max) },
                      ])
                  : "";
              }
              if (TEXT_FIELD_TYPES.has(f.type)) {
                const answers = subs.map((s) => formatAnswer(getAnswer(s, f.id))).filter(Boolean);
                return answers.length
                  ? pdfHeading(f.label) + pdfTable(["Latest answers"], answers.slice(0, 15).map((a) => [a])) + (answers.length > 15 ? pdfNote(`${answers.length - 15} more in the CSV export.`) : "")
                  : "";
              }
              return "";
            })
            .join("");
          body =
            pdfStats([
              stat("Responses", formatCount(subs.length), searchQuery.trim() ? undefined : formSubmissions.length, previousFormCounts?.get(selectedForm.id)),
              { label: "Questions", value: formatCount(fields.length) },
            ]) +
            (searchQuery.trim() ? pdfNote(`Only responses matching "${searchQuery.trim()}".`) : "") +
            summaries +
            pdfHeading("All responses") +
            pdfTable(
              ["#", "Date", ...fields.map((f) => f.label)],
              subs.map((s, i) => [
                i + 1,
                s.submitted_at ? new Date(s.submitted_at).toLocaleDateString("en-US") : "-",
                ...fields.map((f) => {
                  const value = getAnswer(s, f.id);
                  if (mediaUrl(f, value)) return f.type === "image" ? "Photo uploaded" : f.type === "audio" ? "Recording uploaded" : "File uploaded";
                  return formatAnswer(value) || "-";
                }),
              ]),
            );
        } else {
          const counts = new Map<string, number>();
          for (const s of periodSubmissions) counts.set(s.form_id, (counts.get(s.form_id) ?? 0) + 1);
          body =
            pdfStats([stat("Responses", formatCount(periodSubmissions.length), periodSubmissions.length, prevSubmissions?.length)]) +
            pdfHeading("Responses by form") +
            pdfTable(
              ["Form", "Responses", ...(previousFormCounts ? ["Change"] : [])],
              pickerForms
                .map((f) => ({ f, n: counts.get(f.id) ?? 0 }))
                .sort((a, b) => b.n - a.n)
                .map(({ f, n }) => [
                  f.title + (f.is_archived ? " (archived)" : ""),
                  n,
                  ...(previousFormCounts ? [(() => { const c = percentChange(n, previousFormCounts.get(f.id) ?? 0); return c == null ? "new" : formatChange(c); })()] : []),
                ]),
            );
        }
        break;
    }

    if (reportType === "outcomes") {
      body =
        pdfStats([
          { label: "Outcome questions", value: formatCount(outcomes.length) },
          { label: "People measured", value: formatCount(Math.max(0, ...outcomes.map((o) => o.people_measured))) },
          { label: "Measured more than once", value: formatCount(Math.max(0, ...outcomes.map((o) => o.people_with_followup))) },
        ]) +
        pdfHeading("Results by question") +
        pdfTable(
          ["Question", "Measured twice+", "Average first", "Average latest", "Improved", "No change", "Declined"],
          outcomes.map((o) => [
            `${o.label} (${o.form_title})`,
            o.people_with_followup,
            formatScore(o, o.average_first),
            formatScore(o, o.average_latest),
            o.people_with_followup ? `${o.improved} (${improvedPercent(o)}%)` : "-",
            o.same,
            o.worse,
          ]),
        ) +
        pdfNote("Includes people with a check-in in this period, comparing their first check-in ever with their latest.");
    }
    if (reportType === "services") {
      const sv = serviceStats;
      body =
        pdfStats([
          stat("Times help was given", formatCount(sv.count), sv.count, sv.prev?.count),
          stat("People helped", formatCount(sv.people), sv.people, sv.prev?.people),
          stat("Value of help", formatCurrency(sv.value), sv.value, sv.prev?.value),
          stat("Value per person", formatCurrency(sv.perPerson), sv.perPerson, sv.prev?.perPerson),
        ]) +
        pdfHeading("By type") +
        pdfTable(
          ["Help given", "Times", "Value"],
          sv.byType.map((t) => [t.name, t.value, formatCurrency(sv.valueByType.find((v) => v.name === t.name)?.value ?? 0)]),
        );
    }
    const title = reportType === "forms" && selectedForm ? `${selectedForm.title}: Responses` : tabInfo.title;
    const periodLine =
      reportType === "inventory"
        ? "Current stock levels"
        : `${periodLabel}${previous ? ` · compared with ${describePeriod(previous.from, previous.to)}` : ""}`;
    const opened = openPrintableReport({
      title,
      periodLine,
      orgName,
      logoUrl: branding.logoUrl,
      brandColor: branding.primaryColor,
      highlights: highlights(),
      body,
      chartsRoot: panelRef.current,
    });
    if (!opened) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site to export a PDF, then try again.", variant: "destructive" });
    }
  };

  // -------------------------------------------------------------------------
  // Tabs keyboard support: arrow keys move between tabs.
  // -------------------------------------------------------------------------

  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const target = e.key === "Home" ? 0 : e.key === "End" ? REPORT_TYPES.length - 1 : delta ? (index + delta + REPORT_TYPES.length) % REPORT_TYPES.length : null;
    if (target === null) return;
    e.preventDefault();
    setReportType(REPORT_TYPES[target].value);
    tabRefs.current[target]?.focus();
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const d = donationStats;
  const v = volunteerStats;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ===== Header and exports ===== */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Reports</h1>
          <p className="text-muted-foreground">Track your impact, and share it with your board, donors and funders</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowFunderPortals(true)}>
            <Share2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Funder portals
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} disabled={!canExport}>
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> CSV
          </Button>
          <Button size="sm" onClick={exportPDF} disabled={!canExport}>
            <FileDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Export PDF
          </Button>
        </div>
      </div>

      {hasSampleData && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          Sample data isn't included in reports.{" "}
          <Link href="/" className="text-primary underline underline-offset-4 hover:no-underline">
            Clear it from the dashboard
          </Link>
        </p>
      )}

      {/* ===== Tabs ===== */}
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Report type">
        {REPORT_TYPES.map((rt, i) => {
          const Icon = rt.icon;
          const isActive = reportType === rt.value;
          return (
            <button
              key={rt.value}
              ref={(el) => (tabRefs.current[i] = el)}
              type="button"
              role="tab"
              id={`report-tab-${rt.value}`}
              aria-selected={isActive}
              aria-controls="report-panel"
              tabIndex={isActive ? 0 : -1}
              onClick={() => setReportType(rt.value)}
              onKeyDown={(e) => onTabKey(e, i)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                isActive ? "bg-primary text-primary-foreground border-primary" : "border-border hover:border-primary/60 hover:bg-muted"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {rt.label}
            </button>
          );
        })}
      </div>

      {/* ===== Report period ===== */}
      {reportType !== "inventory" ? (
        <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm font-medium">Report period</span>
            <span className="text-sm text-muted-foreground">{periodLabel}</span>
            {previous && (
              <span className="text-xs text-muted-foreground">· compared with {describePeriod(previous.from, previous.to)}</span>
            )}
            {isRefreshing && (
              <span className="text-xs text-muted-foreground" role="status">
                · Updating...
              </span>
            )}
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="period-preset" className="text-xs text-muted-foreground">
                Quick select
              </Label>
              <Select value={periodPreset} onValueChange={(val) => applyPreset(val as PeriodPreset)}>
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
              <Input id="period-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => changeDate("from", e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="period-to" className="text-xs text-muted-foreground">
                To
              </Label>
              <Input id="period-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => changeDate("to", e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          {periodError && (
            <p role="alert" className="text-xs text-destructive">
              {periodError} The report shows the last valid period until it's fixed.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Inventory always shows current stock levels.</p>
      )}

      <div id="report-panel" role="tabpanel" aria-labelledby={`report-tab-${reportType}`} ref={panelRef} className="space-y-6">
        {/* =============================== IMPACT =============================== */}
        {reportType === "impact" && (
          <>
            <StatGrid
              compareLabel={compareLabel}
              stats={[
                { label: "Total raised", value: formatCurrency(d.total), icon: DollarSign, change: percentChange(d.total, d.prev?.total) },
                { label: "Volunteer hours", value: formatHours(v.totalHours), icon: Clock, change: percentChange(v.totalHours, v.prev?.totalHours) },
                { label: "Form responses", value: formatCount(periodSubmissions.length), icon: FileText, change: percentChange(periodSubmissions.length, prevSubmissions?.length) },
                { label: "Donors", value: formatCount(d.donors), icon: Users, change: percentChange(d.donors, d.prev?.donors) },
              ]}
            />
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Donations over time" description={`Per ${granularityLabel(granularity)}`}>
                <TimeSeriesChart data={d.series} kind="area" seriesName="Donations" valueFormatter={formatCurrency} yTickFormatter={(x) => `$${x.toLocaleString("en-US")}`} />
              </ChartCard>
              <ChartCard title="Volunteer hours over time" description={`Per ${granularityLabel(granularity)}`}>
                <TimeSeriesChart data={v.series} kind="bar" color={COLORS[1]} seriesName="Hours" valueFormatter={(x) => `${formatHours(x)} hrs`} />
              </ChartCard>
            </div>
            <GoalsCard goals={goals} campaigns={campaignNames} onChanged={goals.reload} limit={3} />
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
          </>
        )}

        {/* ============================== DONATIONS ============================= */}
        {reportType === "donations" && (
          <>
            <StatGrid
              compareLabel={compareLabel}
              stats={[
                { label: "Total raised", value: formatCurrency(d.total), change: percentChange(d.total, d.prev?.total) },
                { label: "Gifts", value: formatCount(d.count), change: percentChange(d.count, d.prev?.count) },
                { label: "Donors", value: formatCount(d.donors), change: percentChange(d.donors, d.prev?.donors) },
                { label: "Average gift", value: formatCurrency(d.average), change: percentChange(d.average, d.prev?.average) },
              ]}
            />
            <StatGrid
              stats={[
                d.newDonors != null
                  ? { label: "New donors", value: formatCount(d.newDonors), sub: "First gift in this period" }
                  : { label: "One-time donors", value: formatCount(d.donors - d.repeatDonors), sub: "Gave once" },
                d.returningDonors != null
                  ? { label: "Returning donors", value: formatCount(d.returningDonors), sub: "Gave before this period too" }
                  : { label: "Donors", value: formatCount(d.donors) },
                { label: "Gave more than once", value: formatCount(d.repeatDonors), sub: "In this period" },
                { label: "Largest gift", value: periodDonations.length ? formatCurrency(Math.max(...periodDonations.map((x) => Number(x.amount)))) : "-" },
              ]}
            />

            <div className="grid lg:grid-cols-3 gap-6">
              <ChartCard title="Donations over time" description={`Per ${granularityLabel(granularity)}`} className="lg:col-span-2">
                <TimeSeriesChart data={d.series} kind="area" seriesName="Total" valueFormatter={formatCurrency} yTickFormatter={(x) => `$${x.toLocaleString("en-US")}`} heightClass="h-64" />
              </ChartCard>
              <ChartCard title="By campaign">
                <DonutChart data={d.byCampaign} valueFormatter={formatCurrency} heightClass="h-36" />
              </ChartCard>
            </div>

            <GoalsCard goals={goals} campaigns={campaignNames} onChanged={goals.reload} />

            <div className="grid lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 overflow-auto">
                <div className="p-4 border-b">
                  <h3 className="font-semibold">Top donors</h3>
                  <p className="text-xs text-muted-foreground">By total given in this period</p>
                </div>
                {d.topDonors.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Donor</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Gifts</TableHead>
                        <TableHead>Latest gift</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {d.topDonors.map((x) => (
                        <TableRow key={x.key}>
                          <TableCell className="font-medium">
                            {x.name}
                            {x.isNew && (
                              <Badge variant="secondary" className="ml-2 text-[10px]">
                                New
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-semibold whitespace-nowrap">{formatCurrency(x.total)}</TableCell>
                          <TableCell className="text-right">{x.gifts}</TableCell>
                          <TableCell className="whitespace-nowrap">{formatDate(x.last)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <EmptyChart />
                )}
              </Card>
              <ChartCard title="By payment method">
                <DonutChart data={d.byMethod} valueFormatter={(x) => `${x} ${x === 1 ? "gift" : "gifts"}`} heightClass="h-32" />
              </ChartCard>
            </div>

            {periodDonations.length > 0 ? (
              <Card className="overflow-auto">
                <div className="p-4 border-b">
                  <h3 className="font-semibold">All donations</h3>
                </div>
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
                    {donationsNewestFirst.slice(0, MAX_TABLE_ROWS).map((x) => (
                      <TableRow key={x.id}>
                        <TableCell className="font-medium">{x.donor_name}</TableCell>
                        <TableCell className="text-right text-primary font-semibold whitespace-nowrap">{formatCurrency(Number(x.amount))}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(x.date)}</TableCell>
                        <TableCell>{x.campaign ? <Badge variant="secondary">{x.campaign}</Badge> : "-"}</TableCell>
                        <TableCell>{x.payment_method ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {periodDonations.length > MAX_TABLE_ROWS && (
                  <p className="p-3 text-xs text-muted-foreground text-center border-t">
                    Showing the latest {MAX_TABLE_ROWS} of {formatCount(periodDonations.length)} donations. Export CSV or PDF for the full list.
                  </p>
                )}
              </Card>
            ) : (
              <EmptyChart message="No donations in this period" />
            )}
          </>
        )}

        {/* ============================= VOLUNTEERS ============================= */}
        {reportType === "volunteers" && (
          <>
            <StatGrid
              compareLabel={compareLabel}
              stats={[
                { label: "Total hours", value: formatHours(v.totalHours), change: percentChange(v.totalHours, v.prev?.totalHours) },
                { label: "Volunteers", value: formatCount(v.volunteers), change: percentChange(v.volunteers, v.prev?.volunteers) },
                { label: "Sessions", value: formatCount(v.sessions), change: percentChange(v.sessions, v.prev?.sessions) },
                { label: "Average session", value: v.sessions ? `${formatHours(v.average)} hrs` : "-", change: v.sessions ? percentChange(v.average, v.prev?.average) : null },
              ]}
            />
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Top volunteers" description="By hours in this period">
                <RankedBarChart data={v.top} seriesName="Hours" color={COLORS[1]} valueFormatter={(x) => `${formatHours(x)} hrs`} />
              </ChartCard>
              <ChartCard title="Hours by activity">
                <DonutChart data={v.byActivity} valueFormatter={(x) => `${formatHours(x)} hrs`} />
              </ChartCard>
            </div>
            <ChartCard title="Hours over time" description={`Per ${granularityLabel(granularity)}`}>
              <TimeSeriesChart data={v.series} kind="bar" color={COLORS[1]} seriesName="Hours" valueFormatter={(x) => `${formatHours(x)} hrs`} heightClass="h-56" />
            </ChartCard>
            {periodHours.length > 0 && (
              <Card className="overflow-auto">
                <div className="p-4 border-b">
                  <h3 className="font-semibold">All sessions</h3>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Volunteer</TableHead>
                      <TableHead>Activity</TableHead>
                      <TableHead className="text-right">Hours</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {v.newestFirst.slice(0, MAX_TABLE_ROWS).map((x) => (
                      <TableRow key={x.id}>
                        <TableCell className="font-medium">{x.volunteer_name}</TableCell>
                        <TableCell>{x.activity ?? "-"}</TableCell>
                        <TableCell className="text-right">{formatHours(Number(x.hours))}</TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(x.date)}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-muted-foreground" title={x.notes ?? undefined}>
                          {x.notes || "-"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {periodHours.length > MAX_TABLE_ROWS && (
                  <p className="p-3 text-xs text-muted-foreground text-center border-t">
                    Showing the latest {MAX_TABLE_ROWS} of {formatCount(periodHours.length)} sessions. Export CSV or PDF for the full list.
                  </p>
                )}
              </Card>
            )}
          </>
        )}

        {/* ============================== INVENTORY ============================= */}
        {reportType === "inventory" && (
          <>
            <StatGrid
              stats={[
                { label: "Items", value: formatCount(inventoryStats.total), sub: `${formatCount(inventoryStats.units)} units in stock` },
                { label: "Low stock", value: formatCount(inventoryStats.low), danger: inventoryStats.low > 0 },
                { label: "Out of stock", value: formatCount(inventoryStats.out), danger: inventoryStats.out > 0 },
                { label: "Categories", value: formatCount(inventoryStats.byCategory.length) },
              ]}
            />
            <div className="grid md:grid-cols-2 gap-6">
              <ChartCard title="Lowest stock" description="Compared with each item's restock level; red items need restocking">
                {inventory.length ? (
                  <RankedBarChart data={inventoryStats.lowest} seriesName="Quantity" />
                ) : (
                  <EmptyChart message="No inventory items yet" />
                )}
              </ChartCard>
              <ChartCard title="Items by category">
                <DonutChart data={inventoryStats.byCategory} valueFormatter={(x) => `${x} ${x === 1 ? "item" : "items"}`} />
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
                        <TableHead>Quantity</TableHead>
                        <TableHead>Restock at</TableHead>
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
                              {isOutOfStock(i) ? "Out of stock" : `${getQty(i)} ${i.unit ?? ""}`}
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
          </>
        )}

        {/* ============================== HELP GIVEN ============================ */}
        {reportType === "services" &&
          (services === "missing" ? (
            <Card className="p-6">
              <p className="text-sm text-muted-foreground">
                Recording help needs a database update: run <code className="font-mono text-xs">012_services_and_case_notes.sql</code> in the
                Supabase SQL Editor, then refresh.
              </p>
            </Card>
          ) : (
            <>
              <StatGrid
                compareLabel={compareLabel}
                stats={[
                  { label: "Times help was given", value: formatCount(serviceStats.count), change: percentChange(serviceStats.count, serviceStats.prev?.count) },
                  { label: "People helped", value: formatCount(serviceStats.people), icon: Users, change: percentChange(serviceStats.people, serviceStats.prev?.people) },
                  { label: "Value of help", value: formatCurrency(serviceStats.value), change: percentChange(serviceStats.value, serviceStats.prev?.value) },
                  { label: "Value per person", value: serviceStats.people ? formatCurrency(serviceStats.perPerson) : "-", change: percentChange(serviceStats.perPerson, serviceStats.prev?.perPerson) },
                ]}
              />
              {serviceStats.count === 0 ? (
                <Card className="p-6 text-sm text-muted-foreground">
                  No help recorded in this period. Record help from a person's page on{" "}
                  <Link href="/people" className="text-primary underline underline-offset-4">
                    People
                  </Link>
                  .
                </Card>
              ) : (
                <>
                  <div className="grid lg:grid-cols-3 gap-6">
                    <ChartCard title="Help given over time" description={`Times per ${granularityLabel(granularity)}`} className="lg:col-span-2">
                      <TimeSeriesChart data={serviceStats.series} kind="bar" color={COLORS[1]} seriesName="Times" />
                    </ChartCard>
                    <ChartCard title="By type">
                      <DonutChart data={serviceStats.byType} valueFormatter={(x) => `${x} ${x === 1 ? "time" : "times"}`} heightClass="h-36" />
                    </ChartCard>
                  </div>
                  {serviceStats.valueByType.length > 0 && (
                    <ChartCard title="Value by type">
                      <RankedBarChart
                        seriesName="Value"
                        valueFormatter={formatCurrency}
                        data={serviceStats.valueByType.slice(0, 12).map((t) => ({ label: shorten(t.name, 18), fullName: t.name, value: t.value }))}
                      />
                    </ChartCard>
                  )}
                  <Card className="overflow-auto">
                    <div className="p-4 border-b">
                      <h3 className="font-semibold">All help given</h3>
                    </div>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Person</TableHead>
                          <TableHead>Help given</TableHead>
                          <TableHead className="text-right">Value</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {serviceStats.newestFirst.slice(0, MAX_TABLE_ROWS).map((x) => (
                          <TableRow key={x.id}>
                            <TableCell className="whitespace-nowrap">{formatDate(x.date)}</TableCell>
                            <TableCell>
                              <Link href={`/people/${x.person_id}`} className="hover:underline">
                                {serviceName(x) || "-"}
                              </Link>
                            </TableCell>
                            <TableCell>{x.service_type}</TableCell>
                            <TableCell className="text-right whitespace-nowrap">{x.value == null ? "-" : formatCurrency(Number(x.value))}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {serviceStats.count > MAX_TABLE_ROWS && (
                      <p className="p-3 text-xs text-muted-foreground text-center border-t">
                        Showing the latest {MAX_TABLE_ROWS} of {formatCount(serviceStats.count)}. Export CSV for the full list.
                      </p>
                    )}
                  </Card>
                </>
              )}
            </>
          ))}

        {/* =============================== OUTCOMES ============================= */}
        {reportType === "outcomes" &&
          (outcomesState === "missing" ? (
            <Card className="p-6">
              <p className="text-sm text-muted-foreground">
                Outcomes need a database update: run <code className="font-mono text-xs">010_people_outcomes_funder_portals.sql</code> in the
                Supabase SQL Editor, then refresh.
              </p>
            </Card>
          ) : outcomesState === "error" ? (
            <EmptyChart message="Outcomes couldn't be loaded. Refresh to try again." />
          ) : outcomesState === "loading" ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <OutcomesReport outcomes={outcomes} />
          ))}

        {/* ================================ FORMS =============================== */}
        {reportType === "forms" && (
          <>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5 w-full sm:w-72">
                <Label htmlFor="report-form" className="text-xs text-muted-foreground">
                  Form
                </Label>
                <Select value={selectedForm ? selectedForm.id : ALL_FORMS} onValueChange={selectForm}>
                  <SelectTrigger id="report-form">
                    <SelectValue placeholder="Select a form..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_FORMS}>All forms (overview)</SelectItem>
                    {pickerForms.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.title}
                        {f.is_archived ? " (archived)" : ""}
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
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
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
            </div>

            {selectedForm ? (
              <FormReport
                form={selectedForm}
                submissions={formSubmissions}
                filtered={filteredSubmissions}
                search={searchQuery}
                previousCount={previousFormCounts ? previousFormCounts.get(selectedForm.id) ?? 0 : null}
                compareLabel={compareLabel}
                recent={recent}
                range={chartRange}
                granularity={granularity}
              />
            ) : (
              <FormsOverview
                forms={pickerForms}
                submissions={periodSubmissions}
                previousCounts={previousFormCounts}
                compareLabel={compareLabel}
                onOpen={(id) => selectForm(id)}
              />
            )}
          </>
        )}
      </div>

      {showFunderPortals && <FunderSharesDialog onClose={() => setShowFunderPortals(false)} />}

      {chartRange && reportType !== "inventory" && reportType !== "outcomes" && (
        <p className="text-xs text-muted-foreground">
          Charts cover {formatCount(daysInRange(chartRange.from, chartRange.to))} days, grouped by {granularityLabel(granularity)}.
        </p>
      )}
    </div>
  );
}
