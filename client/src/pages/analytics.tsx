/**
 * AnalyticsPage
 *
 * Route: /analytics. Mission and Enterprise (migration 024).
 * Helps teams decide what to buy, when they're busiest, how fundraising is
 * tracking, and where volunteers are short. Everything comes from
 * get_analytics(); the buying-plan math is in lib/analytics.
 *
 * Sections:
 *   Still collecting  what each section still needs before it's reliable
 *                     (dataReadiness in lib/analytics), with progress
 *   Highlights        a few plain-language findings
 *   Buying plan       per item: use per week, days left, suggested amount
 *   Demand and visits people served, new vs returning, busiest weekdays
 *   Fundraising       this year vs last, average gift, retention, projection
 *   Volunteer coverage hours vs visits by weekday (separate charts, same days)
 */

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartCard, COLORS, StatGrid, TimeSeriesChart, TwoSeriesChart } from "@/components/reports/report-ui";
import { useOrganization } from "@/hooks/use-organization";
import { supabase } from "@/lib/supabase";
import { downloadCsv, exportFileName, formatCount, formatCurrency, formatDate, formatHours, toISODate } from "@/lib/report-utils";
import { monthLabel } from "@/lib/outcomes";
import {
  change,
  dataReadiness,
  n,
  planItem,
  projectYearEnd,
  sortPlans,
  WEEKDAYS,
  type Analytics,
  type AnalyticsSection,
  type BuyStatus,
  type ItemPlan,
  type SectionReadiness,
} from "@/lib/analytics";
import { AlertOctagon, AlertTriangle, CheckCircle2, Clock, DollarSign, Download, HandHeart, Hourglass, Lightbulb, MinusCircle, Package, ShoppingCart, Users } from "lucide-react";

const WEEK_CHOICES = [2, 4, 6, 8, 12];
const WEEKS_KEY = "hm-analytics-weeks";
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Status: always an icon and a label, never color alone. */
const STATUS: Record<BuyStatus, { label: string; icon: typeof AlertOctagon; className: string }> = {
  out: { label: "Out of stock", icon: AlertOctagon, className: "border-destructive/40 bg-destructive/10 text-destructive" },
  this_week: { label: "Runs out this week", icon: AlertTriangle, className: "border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  buy: { label: "Buy soon", icon: ShoppingCart, className: "border-primary/40 bg-primary/10 text-primary" },
  ok: { label: "Enough", icon: CheckCircle2, className: "text-muted-foreground" },
  no_usage: { label: "No recent use", icon: MinusCircle, className: "text-muted-foreground" },
};

const readWeeks = () => {
  try {
    const v = Number(localStorage.getItem(WEEKS_KEY));
    return WEEK_CHOICES.includes(v) ? v : 4;
  } catch {
    return 4;
  }
};

const fmtUnits = (v: number) => (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString("en-US");

export default function AnalyticsPage() {
  const { plan, organization } = useOrganization();
  const [data, setData] = useState<Analytics | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [weeks, setWeeks] = useState(readWeeks);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    document.title = "Analytics - HumMotion";
  }, []);

  useEffect(() => {
    if (!plan.features.analytics) return;
    supabase.rpc("get_analytics").then(({ data: d, error: e }) => {
      if (e || !d) {
        setError(e?.message ?? "Couldn't load analytics.");
        setState("error");
        return;
      }
      setData(d as Analytics);
      setState("ready");
    });
  }, [plan.features.analytics]);

  const plans = useMemo(() => (data ? sortPlans(data.inventory.items.map((i) => planItem(i, weeks))) : []), [data, weeks]);

  if (!plan.features.analytics) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card className="p-6 space-y-2">
          <h1 className="text-xl font-serif font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            See what to buy and when, your busiest days, how fundraising is tracking and where you need volunteers. Included with the
            Mission and Enterprise plans.{" "}
            <a href="/settings#plan" className="underline hover:text-foreground">
              See plans
            </a>
          </p>
        </Card>
      </div>
    );
  }

  if (state === "loading") {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  if (state === "error" || !data) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card role="alert" className="p-6 space-y-2">
          <h1 className="text-xl font-serif font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            {/function .* does not exist|PGRST202/i.test(error)
              ? "Analytics needs a database update: run 024_analytics.sql in the Supabase SQL Editor."
              : error}
          </p>
        </Card>
      </div>
    );
  }

  const { inventory, demand, fundraising: f, volunteers } = data;
  const readiness = dataReadiness(data);
  const notReady = readiness.filter((r) => !r.ready);
  const readinessOf = (section: AnalyticsSection) => readiness.find((r) => r.section === section)!;
  const changeWeeks = (w: number) => {
    setWeeks(w);
    try {
      localStorage.setItem(WEEKS_KEY, String(w));
    } catch {
      // Remembering the choice is a convenience only.
    }
  };

  // ----- Inventory figures -----
  const toBuy = plans.filter((p) => p.suggested > 0);
  const urgent = plans.filter((p) => p.status === "out" || p.status === "this_week");
  const used30 = inventory.items.reduce((s, i) => s + n(i.used_30), 0);
  const shownPlans = showAll ? plans : plans.filter((p) => p.status !== "ok" && p.status !== "no_usage");

  // ----- Demand figures -----
  const peopleChange = change(n(demand.people_90), n(demand.people_prev_90));
  const busiest = [...demand.by_weekday].sort((a, b) => n(b.visits) - n(a.visits))[0];

  // ----- Fundraising figures -----
  const ytd = n(f.ytd);
  const ytdChange = change(ytd, n(f.last_ytd));
  const projected = projectYearEnd(ytd, n(f.day_of_year), n(f.days_in_year));
  const avgGift = n(f.gifts_ytd) ? ytd / n(f.gifts_ytd) : null;
  const retention = n(f.donors_last_year) ? Math.round((n(f.retained_donors) / n(f.donors_last_year)) * 100) : null;
  const thisMonth = new Date().getMonth() + 1;

  // ----- Volunteer coverage: visits per volunteer hour, by weekday -----
  const coverage = WEEKDAYS.map((label, i) => {
    const visits = n(demand.by_weekday[i]?.visits);
    const hours = n(volunteers.by_weekday[i]?.hours);
    return { label, visits, hours, ratio: hours > 0 ? visits / hours : visits > 0 ? Infinity : 0 };
  });
  const stretched = coverage.filter((c) => c.visits > 0).sort((a, b) => b.ratio - a.ratio)[0];

  // ----- Highlights -----
  const highlights: string[] = [];
  if (urgent.length) highlights.push(`${urgent.length} ${urgent.length === 1 ? "item is" : "items are"} out of stock or will run out within a week.`);
  else if (toBuy.length) highlights.push(`${toBuy.length} ${toBuy.length === 1 ? "item needs" : "items need"} buying to cover the next ${weeks} weeks.`);
  if (busiest && n(busiest.visits) > 0) highlights.push(`${WEEKDAYS[busiest.weekday - 1]} is your busiest day (last 90 days).`);
  if (peopleChange !== null) highlights.push(`You served ${Math.abs(peopleChange)}% ${peopleChange >= 0 ? "more" : "fewer"} people in the last 90 days than the 90 before.`);
  if (ytdChange !== null) highlights.push(`Donations are ${Math.abs(ytdChange)}% ${ytdChange >= 0 ? "ahead of" : "behind"} this point last year.`);
  if (stretched && stretched.hours > 0 && stretched.ratio > 0)
    highlights.push(`${stretched.label} has the most visits per volunteer hour (${stretched.ratio.toFixed(1)}), so it may need more volunteers.`);
  else if (stretched && stretched.hours === 0) highlights.push(`${stretched.label} has visits but no volunteer hours logged.`);

  const downloadList = () => {
    downloadCsv(exportFileName([organization?.name ?? "inventory", "shopping list"], "csv"), [
      ["Item", "Category", "In stock", "Unit", "Used per week", "Days left", "Target", "Suggested to buy"],
      ...toBuy.map((p) => [
        p.item.name,
        p.item.category ?? "",
        p.item.quantity,
        p.item.unit ?? "",
        fmtUnits(p.weeklyUse),
        p.daysLeft === null ? "" : Math.floor(p.daysLeft),
        p.item.target_quantity ?? "",
        p.suggested,
      ]),
    ]);
  };

  return (
    <div className="p-6 space-y-10 max-w-7xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold">Analytics</h1>
        <p className="text-muted-foreground">Use your records to decide what to buy, when to staff up, and how fundraising is going.</p>
      </div>

      {/* ===== What still needs more data ===== */}
      {notReady.length > 0 && (
        <Card className="p-5 space-y-3 border-amber-500/40 bg-amber-500/5" role="status">
          <h2 className="flex items-center gap-2 font-semibold">
            <Hourglass className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            {notReady.length === readiness.length ? "Analytics is still collecting data" : "Some sections are still collecting data"}
          </h2>
          <p className="text-sm text-muted-foreground">
            Analytics learns from your records over time. Keep recording help given, stock changes, donations and volunteer hours, and these
            sections fill in on their own.
          </p>
          <ul className="space-y-3">
            {notReady.map((r) => (
              <li key={r.section}>
                <ReadinessLine readiness={r} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ===== Highlights ===== */}
      {highlights.length > 0 && (
        <Card className="p-5 border-l-4 border-l-primary">
          <h2 className="flex items-center gap-2 font-semibold mb-2">
            <Lightbulb className="h-4 w-4 text-primary" aria-hidden="true" /> Highlights
          </h2>
          <ul className="space-y-1 text-sm list-disc pl-5">
            {highlights.map((h) => (
              <li key={h}>{h}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* ===== Buying plan ===== */}
      <section className="space-y-4" aria-labelledby="buying-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 id="buying-heading" className="text-xl font-semibold flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" aria-hidden="true" /> Inventory buying plan
            </h2>
            <p className="text-sm text-muted-foreground">
              Based on the last 90 days of use. Items with a target level are topped up to it; others get enough for the weeks you choose.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="weeks" className="text-sm">
              Cover
            </label>
            <Select value={String(weeks)} onValueChange={(v) => changeWeeks(Number(v))}>
              <SelectTrigger id="weeks" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEK_CHOICES.map((w) => (
                  <SelectItem key={w} value={String(w)}>
                    {w} weeks
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={downloadList} disabled={toBuy.length === 0}>
              <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Shopping list (CSV)
            </Button>
          </div>
        </div>

        <SectionNote readiness={readinessOf("inventory")} />

        <StatGrid
          stats={[
            { label: "Items to buy", value: formatCount(toBuy.length), icon: ShoppingCart },
            { label: "Out or running out this week", value: formatCount(urgent.length), icon: AlertTriangle, danger: urgent.length > 0 },
            { label: "Units given out (30 days)", value: formatCount(used30), icon: HandHeart },
          ]}
        />

        <Card className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">In stock</TableHead>
                <TableHead className="text-right">Used per week</TableHead>
                <TableHead>Runs out</TableHead>
                <TableHead className="text-right">Target</TableHead>
                <TableHead className="text-right">Suggested to buy</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shownPlans.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    {plans.length === 0 ? "No inventory items yet." : "Nothing needs buying right now."}
                  </TableCell>
                </TableRow>
              ) : (
                shownPlans.map((p) => <PlanRow key={p.item.id} plan={p} />)
              )}
            </TableBody>
          </Table>
        </Card>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {inventory.tracking_since
              ? `Stock history since ${formatDate(toISODate(new Date(inventory.tracking_since)))}. Estimates improve as more weeks are recorded.`
              : "Stock history starts now. Estimates appear once items are given out."}{" "}
            Set target levels on items in Inventory.
          </span>
          {plans.length > shownPlans.length || showAll ? (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setShowAll((v) => !v)}>
              {showAll ? "Show only items to act on" : `Show all ${plans.length} items`}
            </Button>
          ) : null}
        </div>

        <ChartCard title="Units given out per week" description="All items, last 12 weeks">
          <TimeSeriesChart
            kind="bar"
            seriesName="Units given out"
            data={inventory.weekly_usage.map((w) => ({ key: w.week, label: formatDate(w.week).replace(/, \d{4}$/, ""), value: n(w.used) }))}
          />
        </ChartCard>
      </section>

      {/* ===== Demand and visits ===== */}
      <section className="space-y-4" aria-labelledby="demand-heading">
        <div className="space-y-1">
          <h2 id="demand-heading" className="text-xl font-semibold flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" aria-hidden="true" /> Demand and visits
          </h2>
          <p className="text-sm text-muted-foreground">People with help given or a form response linked to them.</p>
        </div>
        <SectionNote readiness={readinessOf("demand")} />
        <StatGrid
          compareLabel="vs the 90 days before"
          stats={[
            { label: "People served (90 days)", value: formatCount(n(demand.people_90)), icon: Users, change: peopleChange },
            { label: "New people (90 days)", value: formatCount(n(demand.new_90)), icon: Users },
            { label: "Busiest day", value: busiest && n(busiest.visits) > 0 ? WEEKDAYS[busiest.weekday - 1] : "-", icon: Clock },
          ]}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="New and returning people by month" description="Last 12 months">
            <TwoSeriesChart
              kind="bar"
              names={["New", "Returning"]}
              data={demand.by_month.map((m) => ({ label: monthLabel(m.month), a: n(m.new_people), b: Math.max(0, n(m.people) - n(m.new_people)) }))}
            />
          </ChartCard>
          <ChartCard title="Visits by day of the week" description="Last 90 days">
            <TimeSeriesChart kind="bar" seriesName="Visits" data={demand.by_weekday.map((d) => ({ key: String(d.weekday), label: WEEKDAYS[d.weekday - 1], value: n(d.visits) }))} />
          </ChartCard>
        </div>
        <ChartCard title="Help given by month" description="Last 12 months">
          <TimeSeriesChart kind="bar" color={COLORS[1]} seriesName="Help given" data={demand.by_month.map((m) => ({ key: m.month, label: monthLabel(m.month), value: n(m.help_given) }))} />
        </ChartCard>
      </section>

      {/* ===== Fundraising ===== */}
      <section className="space-y-4" aria-labelledby="fund-heading">
        <div className="space-y-1">
          <h2 id="fund-heading" className="text-xl font-semibold flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-primary" aria-hidden="true" /> Fundraising
          </h2>
          <p className="text-sm text-muted-foreground">This calendar year compared with last year.</p>
        </div>
        <SectionNote readiness={readinessOf("fundraising")} />
        <StatGrid
          compareLabel="vs this point last year"
          stats={[
            { label: "Raised this year", value: formatCurrency(ytd), icon: DollarSign, change: ytdChange },
            { label: "Projected year-end", value: projected === null ? "-" : formatCurrency(projected), sub: `Last year: ${formatCurrency(n(f.last_year_total))}` },
            { label: "Average gift", value: avgGift === null ? "-" : formatCurrency(avgGift), sub: `${formatCount(n(f.donors_ytd))} donors this year` },
            {
              label: "Donors who gave again",
              value: retention === null ? "-" : `${retention}%`,
              sub: n(f.donors_last_year) ? `${formatCount(n(f.retained_donors))} of ${formatCount(n(f.donors_last_year))} from last year` : "No donors last year",
            },
          ]}
        />
        <ChartCard title="Donations by month">
          <TwoSeriesChart
            kind="line"
            names={[`${new Date().getFullYear()}`, `${new Date().getFullYear() - 1}`]}
            valueFormatter={formatCurrency}
            yTickFormatter={(v) => `$${v.toLocaleString("en-US")}`}
            data={f.by_month.map((m) => ({ label: MONTH_NAMES[m.month - 1], a: m.month <= thisMonth ? n(m.this_year) : null, b: n(m.last_year) }))}
          />
        </ChartCard>
        <p className="text-xs text-muted-foreground">The projection assumes the rest of the year raises at the same daily pace as so far.</p>
      </section>

      {/* ===== Volunteer coverage ===== */}
      <section className="space-y-4" aria-labelledby="vol-heading">
        <div className="space-y-1">
          <h2 id="vol-heading" className="text-xl font-semibold flex items-center gap-2">
            <Clock className="h-5 w-5 text-primary" aria-hidden="true" /> Volunteer coverage
          </h2>
          <p className="text-sm text-muted-foreground">Compare when people come with when volunteers are there (last 90 days).</p>
        </div>
        <SectionNote readiness={readinessOf("volunteers")} />
        <div className="grid gap-6 lg:grid-cols-2">
          <ChartCard title="Volunteer hours by day of the week">
            <TimeSeriesChart
              kind="bar"
              color={COLORS[1]}
              seriesName="Volunteer hours"
              valueFormatter={(v) => `${formatHours(v)} hrs`}
              data={volunteers.by_weekday.map((d) => ({ key: String(d.weekday), label: WEEKDAYS[d.weekday - 1], value: n(d.hours) }))}
            />
          </ChartCard>
          <ChartCard title="Visits per volunteer hour" description="Higher means fewer volunteers for the people coming">
            <TimeSeriesChart
              kind="bar"
              seriesName="Visits per volunteer hour"
              valueFormatter={(v) => v.toFixed(1)}
              data={coverage.map((c) => ({ key: c.label, label: c.label, value: Number.isFinite(c.ratio) ? Math.round(c.ratio * 10) / 10 : 0 }))}
            />
          </ChartCard>
        </div>
        <ChartCard title="Volunteer hours by month" description="Last 12 months">
          <TimeSeriesChart
            kind="area"
            color={COLORS[1]}
            seriesName="Volunteer hours"
            valueFormatter={(v) => `${formatHours(v)} hrs`}
            data={volunteers.by_month.map((m) => ({ key: m.month, label: monthLabel(m.month), value: n(m.hours) }))}
          />
        </ChartCard>
      </section>

      <p className="text-xs text-muted-foreground">
        Updated {new Date(data.generated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}. Sample data is left out.
      </p>
    </div>
  );
}

/** One "still collecting" line, with a progress bar when it fills up over time. */
function ReadinessLine({ readiness: r }: { readiness: SectionReadiness }) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm">{r.message}</p>
      {r.progress !== undefined && (
        <div
          className="h-1.5 max-w-md rounded-full bg-muted overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(r.progress * 100)}
          aria-label="Data collected so far"
        >
          <div className="h-full rounded-full bg-amber-500" style={{ width: `${Math.round(r.progress * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Shown at the top of a section that doesn't have enough data yet. */
function SectionNote({ readiness: r }: { readiness: SectionReadiness }) {
  if (r.ready) return null;
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <Hourglass className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
      <div className="flex-1">
        <ReadinessLine readiness={r} />
      </div>
    </div>
  );
}

function PlanRow({ plan: p }: { plan: ItemPlan }) {
  const s = STATUS[p.status];
  const Icon = s.icon;
  const unit = p.item.unit ? ` ${p.item.unit}` : "";
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{p.item.name}</span>
        {p.item.category && <span className="block text-xs text-muted-foreground">{p.item.category}</span>}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatCount(p.item.quantity)}
        {unit}
      </TableCell>
      <TableCell className="text-right tabular-nums">{p.weeklyUse > 0 ? fmtUnits(p.weeklyUse) : "-"}</TableCell>
      <TableCell className="text-sm">
        {p.item.quantity <= 0 ? "Now" : p.runsOut ? `${formatDate(toISODate(p.runsOut))} (${Math.floor(p.daysLeft!)} days)` : "-"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{p.item.target_quantity ?? "-"}</TableCell>
      <TableCell className="text-right tabular-nums font-semibold">
        {p.suggested > 0 ? `${formatCount(p.suggested)}${unit}` : "-"}
        {p.suggested > 0 && <span className="block text-xs font-normal text-muted-foreground">{p.basis === "target" ? "to target" : "for the weeks chosen"}</span>}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={`gap-1 whitespace-nowrap ${s.className}`}>
          <Icon className="h-3 w-3" aria-hidden="true" /> {s.label}
        </Badge>
      </TableCell>
    </TableRow>
  );
}
