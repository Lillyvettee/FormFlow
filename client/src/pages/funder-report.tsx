/**
 * FunderReportPage
 *
 * Route: /share/:token. No sign-in. The live, read-only report behind a
 * funder link (Reports > Funder portals), in the organization's branding.
 *
 * Everything comes from get_funder_report (migration 010), which returns
 * totals, trends, goals and outcomes only: never names, contact details or
 * individual answers. It returns nothing for unknown or paused links.
 */

import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLogo } from "@/components/app-logo";
import { supabase } from "@/lib/supabase";
import { setBrandColor } from "@/lib/brand-color";
import { describePeriod, formatCount, formatCurrency, formatDate, formatHours, percentChange, toISODate } from "@/lib/report-utils";
import { monthLabel, parseOutcomes, type OutcomeResult } from "@/lib/outcomes";
import { ChartCard, COLORS, DonutChart, ProgressBar, RankedBarChart, StatGrid, TimeSeriesChart, type StatItem } from "@/components/reports/report-ui";
import { OutcomesReport } from "@/components/reports/outcomes-report";
import { goalTiming } from "@/components/reports/goals-card";
import { Clock, DollarSign, FileText, Lock, Printer, Users } from "lucide-react";

interface Totals {
  raised: number;
  gifts: number;
  donors: number;
  hours: number;
  volunteers: number;
  sessions: number;
  responses: number;
  people_served: number;
}

interface FunderReport {
  name: string;
  message: string | null;
  sections: string[];
  period: { preset: string; from: string | null; to: string; previous_from: string | null; previous_to: string | null };
  organization: { name: string; logo_url: string | null; primary_color: string | null };
  totals: Totals;
  previous_totals: Totals | null;
  generated_at: string;
  donations_by_month?: { month: string; value: number }[];
  donations_by_campaign?: { name: string; value: number }[];
  hours_by_month?: { month: string; value: number }[];
  hours_by_activity?: { name: string; value: number }[];
  responses_by_form?: { name: string; value: number }[];
  goals?: { name: string; campaign: string | null; target: number; raised: number; start_date: string; end_date: string }[];
  outcomes?: OutcomeResult[];
}

const num = (v: unknown) => Number(v) || 0;
const totalsOf = (t: Record<string, unknown> | null): Totals | null =>
  t
    ? {
        raised: num(t.raised),
        gifts: num(t.gifts),
        donors: num(t.donors),
        hours: num(t.hours),
        volunteers: num(t.volunteers),
        sessions: num(t.sessions),
        responses: num(t.responses),
        people_served: num(t.people_served),
      }
    : null;
const pairs = (rows: unknown) => (Array.isArray(rows) ? rows.map((r) => ({ name: String(r.name), value: num(r.value) })) : []);
const months = (rows: unknown) =>
  Array.isArray(rows) ? rows.map((r) => ({ key: String(r.month), label: monthLabel(String(r.month)), value: num(r.value) })) : [];

export default function FunderReportPage() {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = useState<FunderReport | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const [logoFailed, setLogoFailed] = useState(false);

  // Keep shared reports out of search engines.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  useEffect(() => {
    let cancelled = false;
    supabase.rpc("get_funder_report", { p_token: token }).then(({ data, error }) => {
      if (cancelled) return;
      if (error || !data) {
        setState("unavailable");
        return;
      }
      const r = data as FunderReport;
      setReport({
        ...r,
        totals: totalsOf(r.totals as unknown as Record<string, unknown>)!,
        previous_totals: totalsOf(r.previous_totals as unknown as Record<string, unknown> | null),
        outcomes: r.outcomes ? parseOutcomes(r.outcomes) : undefined,
      });
      setBrandColor("page", r.organization?.primary_color);
      document.title = `${r.organization?.name ?? "Report"}: ${r.name}`;
      setState("ready");
    });
    return () => {
      cancelled = true;
      setBrandColor("page", null);
    };
  }, [token]);

  if (state === "loading") {
    return (
      <div className="min-h-screen bg-background p-6" aria-busy="true">
        <div className="max-w-5xl mx-auto space-y-4">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (state === "unavailable" || !report) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <Card className="max-w-md p-8 text-center space-y-3">
          <Lock className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
          <h1 className="text-lg font-semibold">This report isn't available</h1>
          <p className="text-sm text-muted-foreground">
            The link may be mistyped, paused or no longer shared. Please contact the organization that sent it to you.
          </p>
        </Card>
      </div>
    );
  }

  const { totals: t, previous_totals: p, period, organization: org } = report;
  const has = (s: string) => report.sections.includes(s);
  const compareLabel = p ? "vs previous period" : undefined;
  const periodText = describePeriod(period.from ?? "", period.to);
  const today = toISODate(new Date());

  const headline: StatItem[] = [];
  if (has("donations") || has("impact")) headline.push({ label: "Raised", value: formatCurrency(t.raised), icon: DollarSign, change: percentChange(t.raised, p?.raised) });
  if (has("volunteers") || has("impact")) headline.push({ label: "Volunteer hours", value: formatHours(t.hours), icon: Clock, change: percentChange(t.hours, p?.hours) });
  if (has("outcomes") || has("impact")) headline.push({ label: "People served", value: formatCount(t.people_served), icon: Users, change: percentChange(t.people_served, p?.people_served), sub: "With a check-in this period" });
  if (has("forms") || has("impact")) headline.push({ label: "Form responses", value: formatCount(t.responses), icon: FileText, change: percentChange(t.responses, p?.responses) });

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-5xl mx-auto p-6 space-y-8">
        {/* ----- Header ----- */}
        <header className="flex flex-wrap items-center justify-between gap-4 border-b-4 border-primary pb-5">
          <div className="flex items-center gap-3">
            {org.logo_url && !logoFailed ? (
              <img src={org.logo_url} alt="" className="h-14 max-w-[160px] object-contain" onError={() => setLogoFailed(true)} />
            ) : (
              <AppLogo className="h-10 w-10" />
            )}
            <div>
              <p className="text-sm font-semibold text-primary">{org.name}</p>
              <h1 className="text-2xl font-serif font-bold">{report.name}</h1>
              <p className="text-sm text-muted-foreground">
                {periodText}
                {period.previous_from && period.previous_to && ` · compared with ${describePeriod(period.previous_from, period.previous_to)}`}
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => window.print()} className="print:hidden">
            <Printer className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Print or save PDF
          </Button>
        </header>

        {report.message && (
          <Card className="p-5 border-l-4 border-l-primary">
            <p className="whitespace-pre-line">{report.message}</p>
          </Card>
        )}

        {headline.length > 0 && <StatGrid stats={headline} compareLabel={compareLabel} />}

        {has("donations") && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Donations</h2>
            <StatGrid
              compareLabel={compareLabel}
              stats={[
                { label: "Raised", value: formatCurrency(t.raised), change: percentChange(t.raised, p?.raised) },
                { label: "Gifts", value: formatCount(t.gifts), change: percentChange(t.gifts, p?.gifts) },
                { label: "Donors", value: formatCount(t.donors), change: percentChange(t.donors, p?.donors) },
                { label: "Average gift", value: t.gifts ? formatCurrency(t.raised / t.gifts) : "-" },
              ]}
            />
            <div className="grid md:grid-cols-3 gap-6">
              <ChartCard title="Raised by month" className="md:col-span-2">
                <TimeSeriesChart data={months(report.donations_by_month)} kind="area" seriesName="Raised" valueFormatter={formatCurrency} yTickFormatter={(v) => `$${v.toLocaleString("en-US")}`} />
              </ChartCard>
              <ChartCard title="By campaign">
                <DonutChart data={pairs(report.donations_by_campaign)} valueFormatter={formatCurrency} heightClass="h-36" />
              </ChartCard>
            </div>
          </section>
        )}

        {has("goals") && report.goals && report.goals.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Fundraising goals</h2>
            <Card className="p-6">
              <ul className="space-y-5">
                {report.goals.map((g) => {
                  const target = num(g.target);
                  const raised = num(g.raised);
                  const pct = target ? Math.round((raised / target) * 100) : 0;
                  return (
                    <li key={`${g.name}-${g.start_date}`} className="space-y-2">
                      <div className="flex flex-wrap justify-between gap-2">
                        <p className="font-medium">
                          {g.name}
                          {g.campaign && <span className="text-muted-foreground font-normal"> · {g.campaign}</span>}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(g.start_date)} to {formatDate(g.end_date)} · {goalTiming(g)}
                        </p>
                      </div>
                      <ProgressBar value={raised} max={target} color={today > g.end_date && pct < 100 ? "hsl(220, 9%, 55%)" : undefined} />
                      <p className="text-sm">
                        <strong>{formatCurrency(raised)}</strong> <span className="text-muted-foreground">of {formatCurrency(target)} ({pct}%)</span>
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>
        )}

        {has("volunteers") && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Volunteers</h2>
            <StatGrid
              compareLabel={compareLabel}
              stats={[
                { label: "Hours", value: formatHours(t.hours), change: percentChange(t.hours, p?.hours) },
                { label: "Volunteers", value: formatCount(t.volunteers), change: percentChange(t.volunteers, p?.volunteers) },
                { label: "Sessions", value: formatCount(t.sessions), change: percentChange(t.sessions, p?.sessions) },
                { label: "Average session", value: t.sessions ? `${formatHours(t.hours / t.sessions)} hrs` : "-" },
              ]}
            />
            <div className="grid md:grid-cols-3 gap-6">
              <ChartCard title="Hours by month" className="md:col-span-2">
                <TimeSeriesChart data={months(report.hours_by_month)} kind="bar" color={COLORS[1]} seriesName="Hours" valueFormatter={(v) => `${formatHours(v)} hrs`} />
              </ChartCard>
              <ChartCard title="By activity">
                <DonutChart data={pairs(report.hours_by_activity)} valueFormatter={(v) => `${formatHours(v)} hrs`} heightClass="h-36" />
              </ChartCard>
            </div>
          </section>
        )}

        {has("outcomes") && report.outcomes && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Outcomes</h2>
            <OutcomesReport outcomes={report.outcomes} setupHint={false} />
          </section>
        )}

        {has("forms") && (
          <section className="space-y-4">
            <h2 className="text-xl font-semibold">Form responses</h2>
            <ChartCard title="Responses by form">
              <RankedBarChart
                seriesName="Responses"
                data={pairs(report.responses_by_form).slice(0, 15).map((r) => ({ label: r.name.length > 18 ? `${r.name.slice(0, 18)}...` : r.name, fullName: r.name, value: r.value }))}
              />
            </ChartCard>
          </section>
        )}

        <footer className="border-t pt-4 text-xs text-muted-foreground flex flex-wrap items-center justify-between gap-2">
          <span>
            Shared by {org.name}. A live report: figures update as records are added. Last loaded{" "}
            {new Date(report.generated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}.
          </span>
          <span className="flex items-center gap-1.5">
            <AppLogo className="h-4 w-4" /> Made with HumMotion
          </span>
        </footer>
      </div>
    </div>
  );
}
