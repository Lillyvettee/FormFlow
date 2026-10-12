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
import {
  Plus, Clock, Trash2, Pencil, Download, Users, ArrowUpDown, ChevronLeft, ChevronRight, FileText, AlertCircle,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

/* ----------------------------- Types & constants ----------------------------- */

interface VolunteerHour {
  id: string;
  volunteer_name: string;
  activity: string;
  hours: number;
  date: string; // "YYYY-MM-DD"
  notes: string | null;
  created_at: string;
}

interface FormState {
  name: string;
  names: string; // used in bulk mode, one per line
  bulk: boolean;
  activity: string;
  hours: string;
  date: string;
  notes: string;
}

type SortKey = "volunteer_name" | "activity" | "hours" | "date";
type ChartView = "volunteer" | "activity" | "month";

const PAGE_SIZE = 25;
const MAX_HOURS_PER_ENTRY = 24;

/* --------------------------------- Helpers ---------------------------------- */

/** Local-time YYYY-MM-DD (toISOString() would give the UTC date, which can be "tomorrow"). */
const localDateString = (d: Date = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtHours = (n: number) => round2(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString();
const fmtMonth = (ym: string) =>
  new Date(ym + "-01T00:00:00").toLocaleDateString(undefined, { month: "short", year: "2-digit" });

const emptyForm = (): FormState => ({
  name: "", names: "", bulk: false, activity: "", hours: "", date: localDateString(), notes: "",
});

/** Escapes quotes and neutralises spreadsheet formula injection (=, +, -, @). */
const csvCell = (v: string | number | null | undefined) => {
  if (typeof v === "number") return String(v);
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

const downloadCSV = (rows: (string | number | null)[][], filename: string) => {
  const csv = "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"); // BOM keeps Excel happy with UTF-8
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

const sumBy = <T,>(items: T[], key: (i: T) => string, val: (i: T) => number) => {
  const out: Record<string, number> = {};
  for (const i of items) out[key(i)] = (out[key(i)] ?? 0) + val(i);
  return out;
};

/* ------------------------------- Data hook ---------------------------------- */

function useVolunteerHours(userId: string | undefined) {
  const [records, setRecords] = useState<VolunteerHour[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!userId) return;
    let ignore = false; // stops an older request from overwriting newer results
    (async () => {
      const { data, error } = await supabase
        .from("volunteer_hours")
        .select("*")
        .eq("user_id", userId)
        .order("date", { ascending: false });
      if (ignore) return;
      if (error) setError(error.message);
      else { setError(null); setRecords((data as VolunteerHour[]) ?? []); }
      setIsLoading(false);
    })();
    return () => { ignore = true; };
  }, [userId, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { records, isLoading, error, reload, retry: () => { setIsLoading(true); reload(); } };
}

/* --------------------------------- Page ------------------------------------- */

export default function VolunteerHoursPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { records, isLoading, error, reload, retry } = useVolunteerHours(user?.id);

  // dialog / form
  const [showDialog, setShowDialog] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VolunteerHour | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VolunteerHour | null>(null);

  // filters / sorting / paging
  const [search, setSearch] = useState("");
  const [volunteerFilter, setVolunteerFilter] = useState("");
  const [activityFilter, setActivityFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const [chartView, setChartView] = useState<ChartView>("volunteer");
  const [rateStr, setRateStr] = useState("");

  const today = localDateString();
  const setField = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }));

  /* ----- derived data ----- */

  const volunteerNames = useMemo(() => Array.from(new Set(records.map((r) => r.volunteer_name))).sort(), [records]);
  const activities = useMemo(() => Array.from(new Set(records.map((r) => r.activity))).sort(), [records]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return records.filter((r) => {
      if (volunteerFilter && r.volunteer_name !== volunteerFilter) return false;
      if (activityFilter && r.activity !== activityFilter) return false;
      if (from && r.date < from) return false; // ISO date strings compare correctly as text
      if (to && r.date > to) return false;
      if (q && !`${r.volunteer_name} ${r.activity} ${r.notes ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [records, search, volunteerFilter, activityFilter, from, to]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  useEffect(() => { setPage(0); }, [search, volunteerFilter, activityFilter, from, to, sortKey, sortDir]);

  const stats = useMemo(() => {
    const monthPrefix = today.slice(0, 7);
    const total = filtered.reduce((s, r) => s + Number(r.hours), 0);
    const month = filtered.filter((r) => r.date.startsWith(monthPrefix)).reduce((s, r) => s + Number(r.hours), 0);
    return {
      total: round2(total),
      month: round2(month),
      volunteers: new Set(filtered.map((r) => r.volunteer_name)).size,
      entries: filtered.length,
    };
  }, [filtered, today]);

  const rate = parseFloat(rateStr);
  const estimatedValue = Number.isFinite(rate) && rate > 0 ? stats.total * rate : null;

  const chartData = useMemo(() => {
    const toRows = (m: Record<string, number>, label: (k: string) => string) =>
      Object.entries(m).map(([k, v]) => ({ key: k, fullName: label(k), name: label(k).length > 12 ? label(k).slice(0, 12) + "…" : label(k), hours: round2(v) }));

    if (chartView === "month") {
      const byMonth = sumBy(filtered, (r) => r.date.slice(0, 7), (r) => Number(r.hours));
      return toRows(byMonth, fmtMonth).sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
    }
    const byKey = chartView === "volunteer"
      ? sumBy(filtered, (r) => r.volunteer_name, (r) => Number(r.hours))
      : sumBy(filtered, (r) => r.activity, (r) => Number(r.hours));
    return toRows(byKey, (k) => k).sort((a, b) => b.hours - a.hours).slice(0, 10);
  }, [filtered, chartView]);

  const hasFilters = !!(search || volunteerFilter || activityFilter || from || to);
  const clearFilters = () => { setSearch(""); setVolunteerFilter(""); setActivityFilter(""); setFrom(""); setTo(""); };

  /* ----- actions ----- */

  const resetForm = () => {
    setForm(emptyForm()); setFormError(null); setEditingRecord(null); setShowDialog(false);
  };

  const openEdit = (r: VolunteerHour) => {
    setEditingRecord(r);
    setForm({ ...emptyForm(), name: r.volunteer_name, activity: r.activity, hours: String(r.hours), date: r.date, notes: r.notes ?? "" });
    setFormError(null);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!user) return;
    const names = form.bulk && !editingRecord
      ? Array.from(new Set(form.names.split(/[\n,]/).map((n) => n.trim()).filter(Boolean)))
      : [form.name.trim()].filter(Boolean);
    const h = parseFloat(form.hours);

    if (names.length === 0) return setFormError(form.bulk ? "Enter at least one volunteer name." : "Enter the volunteer's name.");
    if (!form.activity.trim()) return setFormError("Enter an activity.");
    if (!Number.isFinite(h) || h <= 0) return setFormError("Hours must be a number greater than 0.");
    if (h > MAX_HOURS_PER_ENTRY) return setFormError(`An entry can't exceed ${MAX_HOURS_PER_ENTRY} hours.`);
    if (!form.date || form.date > today) return setFormError("Choose a date that is today or earlier.");

    setFormError(null);
    setIsSaving(true);
    try {
      const base = {
        user_id: user.id,
        activity: form.activity.trim(),
        hours: round2(h),
        date: form.date,
        notes: form.notes.trim() || null,
      };

      if (editingRecord) {
        const { error } = await supabase
          .from("volunteer_hours")
          .update({ ...base, volunteer_name: names[0] })
          .eq("id", editingRecord.id)
          .eq("user_id", user.id);
        if (error) throw error;
        toast({ title: "Record updated" });
      } else {
        const { error } = await supabase
          .from("volunteer_hours")
          .insert(names.map((volunteer_name) => ({ ...base, volunteer_name })));
        if (error) throw error;
        toast({ title: names.length > 1 ? `${names.length} entries logged` : "Hours logged" });
      }
      resetForm();
      reload();
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e?.message ?? "Something went wrong. Try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete || !user) return;
    const target = pendingDelete;
    setPendingDelete(null);
    const { error } = await supabase.from("volunteer_hours").delete().eq("id", target.id).eq("user_id", user.id);
    if (error) toast({ title: "Couldn't delete", description: error.message, variant: "destructive" });
    else { toast({ title: "Record deleted" }); reload(); }
  };

  const rangeLabel = from || to ? `_${from || "start"}_to_${to || "today"}` : "";

  const exportDetail = () => {
    downloadCSV(
      [["Volunteer", "Activity", "Hours", "Date", "Notes"], ...sorted.map((r) => [r.volunteer_name, r.activity, Number(r.hours), r.date, r.notes ?? ""])],
      `volunteer-hours${rangeLabel}.csv`
    );
  };

  const exportSummary = () => {
    const entries = (key: (r: VolunteerHour) => string) => {
      const hrs = sumBy(filtered, key, (r) => Number(r.hours));
      const cnt = sumBy(filtered, key, () => 1);
      return Object.keys(hrs).sort((a, b) => hrs[b] - hrs[a]).map((k) => [k, round2(hrs[k]), cnt[k]] as const);
    };
    const rows: (string | number | null)[][] = [
      ["Report period", `${from || "all time"} to ${to || today}`],
      ["Total hours", stats.total],
      ["Volunteers", stats.volunteers],
      ...(estimatedValue !== null ? [["Hourly value used", rate], ["Estimated value", round2(estimatedValue)]] : []),
      [],
      ["Type", "Name", "Hours", "Entries"],
      ...entries((r) => r.activity).map(([k, h, c]) => ["Activity", k, h, c]),
      ...entries((r) => r.volunteer_name).map(([k, h, c]) => ["Volunteer", k, h, c]),
    ];
    downloadCSV(rows, `volunteer-summary${rangeLabel}.csv`);
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "hours" || key === "date" ? "desc" : "asc"); }
  };

  const SortHead = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <TableHead className={className} aria-sort={sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(k)}>
        {label} <ArrowUpDown className="h-3 w-3 opacity-60" />
      </button>
    </TableHead>
  );

  const selectClass = "h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  /* ---------------------------------- Render ---------------------------------- */

  const statCards: { label: string; value: string | number }[] = [
    { label: "Total Hours", value: fmtHours(stats.total) },
    { label: "This Month", value: fmtHours(stats.month) },
    { label: "Volunteers", value: stats.volunteers },
    { label: "Entries", value: stats.entries },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Volunteer Hours</h1>
          <p className="text-muted-foreground">Track volunteer time for grant applications and impact reports</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {records.length > 0 && (
            <>
              <Button variant="outline" onClick={exportSummary}>
                <FileText className="mr-1 h-4 w-4" /> Summary report
              </Button>
              <Button variant="outline" onClick={exportDetail}>
                <Download className="mr-1 h-4 w-4" /> Export CSV
              </Button>
            </>
          )}
          <Button onClick={() => setShowDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> Log Hours
          </Button>
        </div>
      </div>

      {/* Load error */}
      {error && (
        <Card className="p-4 flex items-center justify-between gap-4 border-destructive/50">
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
            <span>Couldn't load your volunteer hours: {error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={retry}>Try again</Button>
        </Card>
      )}

      {/* Filters */}
      {records.length > 0 && (
        <Card className="p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 flex-1 min-w-[180px]">
              <Label htmlFor="vh-search" className="text-xs">Search</Label>
              <Input id="vh-search" placeholder="Name, activity, or notes" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vh-volunteer" className="text-xs">Volunteer</Label>
              <select id="vh-volunteer" className={selectClass} value={volunteerFilter} onChange={(e) => setVolunteerFilter(e.target.value)}>
                <option value="">All</option>
                {volunteerNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="vh-activity" className="text-xs">Activity</Label>
              <select id="vh-activity" className={selectClass} value={activityFilter} onChange={(e) => setActivityFilter(e.target.value)}>
                <option value="">All</option>
                {activities.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="vh-from" className="text-xs">From</Label>
              <Input id="vh-from" type="date" max={to || today} value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vh-to" className="text-xs">To</Label>
              <Input id="vh-to" type="date" min={from || undefined} max={today} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="space-y-1 w-28">
              <Label htmlFor="vh-rate" className="text-xs">Value per hour ($)</Label>
              <Input id="vh-rate" type="number" min="0" step="0.01" placeholder="Optional" value={rateStr} onChange={(e) => setRateStr(e.target.value)} />
            </div>
            {hasFilters && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
          </div>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="p-4 text-center">
            {isLoading ? <Skeleton className="h-7 w-16 mx-auto" /> : <p className="text-xl font-bold text-primary">{stat.value}</p>}
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
          </Card>
        ))}
      </div>
      {estimatedValue !== null && (
        <p className="text-sm text-muted-foreground -mt-2">
          Estimated value of {fmtHours(stats.total)} hours at ${rate.toFixed(2)}/hr:{" "}
          <span className="font-semibold text-foreground">
            {estimatedValue.toLocaleString(undefined, { style: "currency", currency: "USD" })}
          </span>
        </p>
      )}

      {/* Chart */}
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : chartData.length > 0 ? (
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              {chartView === "volunteer" ? "Top Volunteers by Hours" : chartView === "activity" ? "Hours by Activity" : "Hours by Month"}
            </h2>
            <div className="flex gap-1" role="group" aria-label="Chart view">
              {([["volunteer", "Volunteers"], ["activity", "Activities"], ["month", "Months"]] as const).map(([v, label]) => (
                <Button key={v} size="sm" variant={chartView === v ? "default" : "outline"} aria-pressed={chartView === v} onClick={() => setChartView(v)}>
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout={chartView === "month" ? "horizontal" : "vertical"}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                {chartView === "month" ? (
                  <>
                    <XAxis type="category" dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <YAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  </>
                ) : (
                  <>
                    <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <YAxis type="category" dataKey="name" width={100} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                  </>
                )}
                <Tooltip
                  formatter={(v) => [`${v} hrs`, "Hours"]}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                  contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }}
                />
                <Bar dataKey="hours" fill="hsl(217, 91%, 35%)" radius={chartView === "month" ? [4, 4, 0, 0] : [0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : records.length > 0 ? (
        sorted.length > 0 ? (
          <Card className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortHead k="volunteer_name" label="Volunteer" />
                  <SortHead k="activity" label="Activity" />
                  <SortHead k="hours" label="Hours" className="text-right" />
                  <SortHead k="date" label="Date" />
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.volunteer_name}</TableCell>
                    <TableCell><Badge variant="secondary">{r.activity}</Badge></TableCell>
                    <TableCell className="text-right font-semibold text-primary">{fmtHours(Number(r.hours))}</TableCell>
                    <TableCell>{fmtDate(r.date)}</TableCell>
                    <TableCell className="max-w-[150px] truncate text-muted-foreground" title={r.notes ?? undefined}>{r.notes ?? "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" aria-label={`Edit entry for ${r.volunteer_name}`} onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label={`Delete entry for ${r.volunteer_name}`} onClick={() => setPendingDelete(r)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {pageCount > 1 && (
              <div className="flex items-center justify-between gap-2 border-t p-3 text-sm text-muted-foreground">
                <span>
                  {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, sorted.length)} of {sorted.length}
                </span>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" aria-label="Previous page" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="px-2">Page {safePage + 1} of {pageCount}</span>
                  <Button variant="outline" size="icon" aria-label="Next page" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ) : (
          <div className="text-center py-12 space-y-3">
            <p className="font-semibold">No entries match these filters</p>
            <Button variant="outline" onClick={clearFilters}>Clear filters</Button>
          </div>
        )
      ) : !error ? (
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Clock className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No hours logged yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Track volunteer time to strengthen grant applications and show your community impact.</p>
          </div>
          <Button onClick={() => setShowDialog(true)}><Plus className="mr-1 h-4 w-4" /> Log First Hours</Button>
        </div>
      ) : null}

      {/* Add / edit dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); else setShowDialog(true); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingRecord ? "Edit Hours" : "Log Volunteer Hours"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            {form.bulk && !editingRecord ? (
              <div className="space-y-2">
                <Label htmlFor="vh-names">Volunteer names <span className="text-muted-foreground font-normal">(one per line)</span></Label>
                <Textarea id="vh-names" rows={5} placeholder={"Ana Torres\nSam Lee\nPriya Patel"} value={form.names} onChange={(e) => setField("names", e.target.value)} />
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="vh-name">Volunteer Name</Label>
                <Input id="vh-name" placeholder="Full Name Here" value={form.name} onChange={(e) => setField("name", e.target.value)} list="volunteer-names" />
                {volunteerNames.length > 0 && <datalist id="volunteer-names">{volunteerNames.map((n) => <option key={n} value={n} />)}</datalist>}
              </div>
            )}
            {!editingRecord && (
              <button
                type="button"
                className="text-sm text-primary underline-offset-4 hover:underline -mt-2"
                onClick={() => setField("bulk", !form.bulk)}
              >
                {form.bulk ? "Log one volunteer instead" : "Log several volunteers for the same activity"}
              </button>
            )}
            <div className="space-y-2">
              <Label htmlFor="vh-act">Activity</Label>
              <Input id="vh-act" placeholder="Food distribution, Event setup..." value={form.activity} onChange={(e) => setField("activity", e.target.value)} list="activities" />
              {activities.length > 0 && <datalist id="activities">{activities.map((a) => <option key={a} value={a} />)}</datalist>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="vh-hours">{form.bulk && !editingRecord ? "Hours each" : "Hours"}</Label>
                <Input id="vh-hours" type="number" min="0.25" max={MAX_HOURS_PER_ENTRY} step="0.25" placeholder="2.5" value={form.hours} onChange={(e) => setField("hours", e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vh-date">Date</Label>
                <Input id="vh-date" type="date" max={today} value={form.date} onChange={(e) => setField("date", e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vh-notes">Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea id="vh-notes" placeholder="Any additional notes..." value={form.notes} onChange={(e) => setField("notes", e.target.value)} />
            </div>
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : editingRecord ? "Update" : "Log Hours"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!pendingDelete} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete && `${fmtHours(Number(pendingDelete.hours))} hours for ${pendingDelete.volunteer_name} on ${fmtDate(pendingDelete.date)} will be permanently removed.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete entry</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}