import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  FileText, BarChart3, Package, Plus, ArrowRight,
  DollarSign, Clock, AlertTriangle, CheckCircle2, Users, TrendingUp, Image, AlertCircle,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { fetchAll, getThreshold, type InventoryRow } from "@/lib/report-utils";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { SampleDataCard } from "@/components/sample-data-card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { Form, InventoryItem } from "@/types/database";

/* ----------------------------- Types & constants ----------------------------- */

interface ActivityItem {
  label: string;
  ts: number;
  type: "form" | "donation" | "volunteer";
}

interface DashboardData {
  forms: Form[]; // non-archived forms, newest first
  totalSubmissions: number;
  submissionsThisMonth: number;
  inventoryItems: InventoryItem[];
  totalDonations: number;
  donationsThisMonth: number;
  totalVolunteerHours: number;
  volunteerHoursThisMonth: number;
  recentActivity: ActivityItem[];
  submissionsByDay: { date: string; count: number }[];
}

const CHART_DAYS = 14;

/* --------------------------------- Helpers ---------------------------------- */

/** Local-time YYYY-MM-DD (toISOString() would give the UTC date). */
const localDateString = (d: Date = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtMoney = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const fmtHours = (n: number) => round2(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
};

const timeAgo = (ts: number) => {
  const diffSec = Math.round((ts - Date.now()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const abs = Math.abs(diffSec);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diffSec / 86400), "day");
  return new Date(ts).toLocaleDateString();
};

const activityIcons = { form: FileText, donation: DollarSign, volunteer: Users } as const;
const activityColors = {
  form: "bg-primary/10 text-primary",
  donation: "bg-chart-2/10 text-chart-2",
  volunteer: "bg-chart-3/10 text-chart-3",
} as const;

const focusRing = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md";

/* ------------------------------- Data loading ------------------------------- */

async function fetchDashboard(userId: string): Promise<DashboardData> {
  const now = new Date();
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthPrefix = localDateString(now).slice(0, 7);
  const chartStart = new Date(now);
  chartStart.setDate(chartStart.getDate() - (CHART_DAYS - 1));
  chartStart.setHours(0, 0, 0, 0);

  // One forms query covers both the display list and the submission lookups.
  const formsRes = await supabase
    .from("forms")
    .select("*")
    .order("created_at", { ascending: false });
  if (formsRes.error) throw formsRes.error;

  const allForms = (formsRes.data ?? []) as Form[];
  const formIds = allForms.map((f) => f.id);
  const emptyList = { data: [] as any[], error: null, count: 0 };

  const [inventoryRes, donationsRes, volunteerRes, subsTotalRes, subsMonthRes, subsChartRes, subsRecentRes] =
    await Promise.all([
      supabase.from("inventory_items").select("*"),
      // Paged so totals aren't capped at Supabase's 1000-row limit.
      fetchAll<any>((f, t) =>
        supabase.from("donations").select("id, amount, date, created_at, donor_name").order("created_at", { ascending: false }).order("id").range(f, t),
      ).then((data) => ({ data, error: null })),
      fetchAll<any>((f, t) =>
        supabase.from("volunteer_hours").select("id, hours, date, created_at, volunteer_name, activity").order("created_at", { ascending: false }).order("id").range(f, t),
      ).then((data) => ({ data, error: null })),
      // Real counts (head requests) so totals aren't capped by a row limit.
      formIds.length
        ? supabase.from("form_submissions").select("id", { count: "exact", head: true }).in("form_id", formIds)
        : Promise.resolve(emptyList),
      formIds.length
        ? supabase.from("form_submissions").select("id", { count: "exact", head: true }).in("form_id", formIds).gte("submitted_at", monthStartIso)
        : Promise.resolve(emptyList),
      formIds.length
        ? supabase.from("form_submissions").select("submitted_at").in("form_id", formIds).gte("submitted_at", chartStart.toISOString()).limit(5000)
        : Promise.resolve(emptyList),
      formIds.length
        ? supabase.from("form_submissions").select("submitted_at, form_id").in("form_id", formIds).order("submitted_at", { ascending: false }).limit(5)
        : Promise.resolve(emptyList),
    ]);

  const firstError = [inventoryRes, donationsRes, volunteerRes, subsTotalRes, subsMonthRes, subsChartRes, subsRecentRes]
    .map((r) => r.error)
    .find(Boolean);
  if (firstError) throw firstError;

  const inventory = (inventoryRes.data ?? []) as InventoryItem[];
  const donations = donationsRes.data ?? [];
  const volunteerHours = volunteerRes.data ?? [];
  const chartSubs = subsChartRes.data ?? [];
  const recentSubs = subsRecentRes.data ?? [];

  // Submissions by day (last 14 days), keyed by local date so labels can't collide.
  const dayBuckets = new Map<string, { date: string; count: number }>();
  for (let i = CHART_DAYS - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    dayBuckets.set(localDateString(d), {
      date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      count: 0,
    });
  }
  chartSubs.forEach((s: { submitted_at: string }) => {
    const bucket = dayBuckets.get(localDateString(new Date(s.submitted_at)));
    if (bucket) bucket.count++;
  });

  // Recent activity feed (latest events across all tables)
  const activity: ActivityItem[] = [];
  recentSubs.forEach((s: { submitted_at: string; form_id: string }) => {
    const form = allForms.find((f) => f.id === s.form_id);
    activity.push({ label: `New submission on "${form?.title ?? "a form"}"`, ts: new Date(s.submitted_at).getTime(), type: "form" });
  });
  donations.slice(0, 3).forEach((d: any) => {
    activity.push({ label: `${fmtMoney(Number(d.amount))} donation from ${d.donor_name}`, ts: new Date(d.created_at).getTime(), type: "donation" });
  });
  volunteerHours.slice(0, 3).forEach((v: any) => {
    activity.push({ label: `${fmtHours(Number(v.hours))}h logged by ${v.volunteer_name} (${v.activity})`, ts: new Date(v.created_at).getTime(), type: "volunteer" });
  });
  activity.sort((a, b) => b.ts - a.ts);

  return {
    forms: allForms.filter((f) => !(f as any).is_archived),
    totalSubmissions: subsTotalRes.count ?? 0,
    submissionsThisMonth: subsMonthRes.count ?? 0,
    inventoryItems: inventory,
    totalDonations: donations.reduce((s: number, d: any) => s + Number(d.amount), 0),
    // By the donation's own date (what the Donations and Reports pages show), not when it was typed in.
    donationsThisMonth: donations.filter((d: any) => String(d.date).startsWith(monthPrefix)).reduce((s: number, d: any) => s + Number(d.amount), 0),
    totalVolunteerHours: round2(volunteerHours.reduce((s: number, v: any) => s + Number(v.hours), 0)),
    // Uses the activity date (what the Volunteer Hours page shows), not the row's created_at.
    volunteerHoursThisMonth: round2(
      volunteerHours.filter((v: any) => String(v.date).startsWith(monthPrefix)).reduce((s: number, v: any) => s + Number(v.hours), 0)
    ),
    recentActivity: activity.slice(0, 8),
    submissionsByDay: Array.from(dayBuckets.values()),
  };
}

/* --------------------------------- Page ------------------------------------- */

export default function DashboardPage() {
  const { user } = useAuth();
  const { canEdit } = useOrganization();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!user) return;
    let ignore = false; // prevents a stale request from overwriting newer state
    setIsLoading(true);
    fetchDashboard(user.id)
      .then((d) => { if (!ignore) { setData(d); setError(null); } })
      .catch((e) => { if (!ignore) setError(e?.message ?? "Something went wrong."); })
      .finally(() => { if (!ignore) setIsLoading(false); });
    return () => { ignore = true; };
  }, [user, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  const fullName = user?.user_metadata?.full_name?.split(" ")[0] ?? "there";

  const lowStockItems = useMemo(
    () =>
      (data?.inventoryItems.filter((i) => i.quantity <= getThreshold(i as unknown as InventoryRow)) ?? []).sort(
        (a, b) => a.quantity - b.quantity,
      ),
    [data]
  );

  const hasChartData = (data?.submissionsByDay ?? []).some((d) => d.count > 0);

  const stats = data
    ? [
        {
          label: "Total Raised",
          value: fmtMoney(data.totalDonations),
          sub: `${fmtMoney(data.donationsThisMonth)} this month`,
          icon: DollarSign, color: "text-chart-2", bg: "bg-chart-2/10", href: "/reports?tab=donations&period=this_month",
        },
        {
          label: "Volunteer Hours",
          value: fmtHours(data.totalVolunteerHours),
          sub: `${fmtHours(data.volunteerHoursThisMonth)} this month`,
          icon: Clock, color: "text-chart-3", bg: "bg-chart-3/10", href: "/reports?tab=volunteers&period=this_month",
        },
        {
          label: "Form Submissions",
          value: data.totalSubmissions.toLocaleString(),
          sub: `${data.submissionsThisMonth.toLocaleString()} this month`,
          icon: FileText, color: "text-primary", bg: "bg-primary/10", href: "/reports?tab=forms&period=this_month",
        },
        {
          label: "Active Forms",
          value: data.forms.filter((f) => f.is_published).length,
          sub: `${data.forms.length} total`,
          icon: BarChart3, color: "text-chart-4", bg: "bg-chart-4/10", href: "/forms",
        },
        {
          label: "Inventory Items",
          value: data.inventoryItems.length.toLocaleString(),
          sub: lowStockItems.length ? `${lowStockItems.length} low or out of stock` : "All stocked",
          icon: Package, color: "text-chart-5", bg: "bg-chart-5/10", href: "/reports?tab=inventory",
        },
      ]
    : [];

  const quickActions = [
    { label: "New Form", icon: FileText, href: "/forms" },
    { label: "Record Donation", icon: DollarSign, href: "/donations" },
    { label: "Log Volunteer Hours", icon: Clock, href: "/volunteer-hours" },
    { label: "Add Inventory Item", icon: Package, href: "/inventory" },
    { label: "Upload Media", icon: Image, href: "/media" },
    { label: "View Reports", icon: BarChart3, href: "/reports" },
  ];

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold" data-testid="text-dashboard-title">
            {greeting()}, {fullName}
          </h1>
          <p className="text-muted-foreground">Here's your organization's impact at a glance</p>
        </div>
        {canEdit && (
          <Link href="/forms">
            <Button data-testid="button-new-form">
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> New Form
            </Button>
          </Link>
        )}
      </div>

      <SampleDataCard onChanged={retry} />

      {/* Load error */}
      {error && (
        <Card role="alert" className="p-4 flex items-center justify-between gap-4 border-destructive/50">
          <div className="flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
            <span>Couldn't load your dashboard: {error}</span>
          </div>
          <Button variant="outline" size="sm" onClick={retry}>Try again</Button>
        </Card>
      )}

      {/* Low stock alert */}
      {lowStockItems.length > 0 && (
        <Card className="p-4 border-destructive/40 bg-destructive/5" role="status">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
            <span className="text-sm font-medium text-destructive">Low Stock Alert</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {lowStockItems.map((i) => (
              <Link key={i.id} href="/inventory" className={focusRing}>
                <Badge variant="destructive" className="cursor-pointer text-xs">
                  {i.name}: {i.quantity <= 0 ? "Out of stock" : `${i.quantity} left`}
                </Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {isLoading
          ? [1, 2, 3, 4, 5].map((i) => <Card key={i} className="p-5"><Skeleton className="h-20 w-full" /></Card>)
          : stats.map((stat) => (
              <Link key={stat.label} href={stat.href} className={`block ${focusRing}`}>
                <Card className="p-5 hover-elevate cursor-pointer h-full">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <div className={`h-9 w-9 rounded-md ${stat.bg} flex items-center justify-center shrink-0`}>
                      <stat.icon className={`h-4 w-4 ${stat.color}`} aria-hidden="true" />
                    </div>
                  </div>
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                    <TrendingUp className="h-3 w-3" aria-hidden="true" /> {stat.sub}
                  </p>
                </Card>
              </Link>
            ))}
      </div>

      {/* Chart + Activity */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="font-semibold text-lg">Submissions: Last {CHART_DAYS} Days</h2>
              <p className="text-sm text-muted-foreground">Form responses received per day</p>
            </div>
            <Link href="/reports?tab=forms&period=last_30">
              <Button variant="outline" size="sm">
                Reports <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </Link>
          </div>
          {isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : !hasChartData ? (
            <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
              No submissions in the last {CHART_DAYS} days.
            </div>
          ) : (
            <div className="h-48" role="img" aria-label={`Area chart of form submissions per day over the last ${CHART_DAYS} days`}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.submissionsByDay ?? []}>
                  <defs>
                    <linearGradient id="subGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(217, 91%, 35%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(217, 91%, 35%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} interval={1} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px", color: "hsl(var(--foreground))" }} />
                  <Area type="monotone" dataKey="count" stroke="hsl(217, 91%, 35%)" fill="url(#subGrad)" strokeWidth={2} name="Submissions" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-lg mb-4">Recent Activity</h2>
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : data?.recentActivity.length ? (
            <ul className="space-y-3">
              {data.recentActivity.map((item, i) => {
                const Icon = activityIcons[item.type];
                return (
                  <li key={`${item.type}-${item.ts}-${i}`} className="flex items-start gap-3">
                    <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 ${activityColors[item.type]}`}>
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug truncate" title={item.label}>{item.label}</p>
                      <p className="text-xs text-muted-foreground">
                        <time dateTime={new Date(item.ts).toISOString()}>{timeAgo(item.ts)}</time>
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="text-center py-8 space-y-2">
              <CheckCircle2 className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">No activity yet. Start by creating a form.</p>
            </div>
          )}
        </Card>
      </div>

      {/* Bottom row: recent forms + quick actions */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="font-semibold text-lg">Recent Forms</h2>
            <Link href="/forms">
              <Button variant="outline" size="sm" data-testid="button-view-all-forms">
                View All <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : data?.forms.length ? (
            <div className="space-y-2">
              {data.forms.slice(0, 5).map((form) => (
                <Link key={form.id} href="/forms" className={`flex items-center justify-between gap-4 p-3 hover:bg-muted/50 transition-colors ${focusRing}`}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{form.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {(() => {
                          const n = Array.isArray(form.fields) ? form.fields.length : 0;
                          return `${n} ${n === 1 ? "field" : "fields"}`;
                        })()}
                      </p>
                    </div>
                  </div>
                  <Badge variant={form.is_published ? "default" : "secondary"}>
                    {form.is_published ? "Published" : "Draft"}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 space-y-3">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                <FileText className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
              </div>
              <p className="text-sm text-muted-foreground">No forms yet</p>
              {canEdit && (
                <Link href="/forms">
                  <Button size="sm" data-testid="button-create-first-form">
                    <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Create Your First Form
                  </Button>
                </Link>
              )}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <h2 className="font-semibold text-lg mb-4">Quick Actions</h2>
          <nav aria-label="Quick actions" className="space-y-1.5">
            {quickActions.map((action) => (
              // Link renders the <a> itself; nesting a <button> inside it is invalid HTML.
              <Link
                key={action.label}
                href={action.href}
                className={`group w-full flex items-center gap-3 p-2.5 text-left hover:bg-muted/60 transition-colors ${focusRing}`}
              >
                <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                  <action.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" aria-hidden="true" />
                </div>
                <span className="text-sm font-medium">{action.label}</span>
                <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity" aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </Card>
      </div>
    </div>
  );
}