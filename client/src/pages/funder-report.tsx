/**
 * FunderReportPage
 *
 * Route: /share/:token. No sign-in. The live, read-only report behind a
 * funder link (Reports > Funder portals), in the organization's branding.
 *
 * Everything comes from get_funder_report (migrations 010 and 020), which
 * returns totals, trends, goals and outcomes only: never names, contact
 * details or individual answers. It returns nothing for unknown or paused
 * links, and only a status for expired, locked or password-protected ones
 * (until the right password is entered here).
 *
 * Sections appear in the order chosen for the link, each with its note.
 */

import { useCallback, useEffect, useState } from "react";
import { useParams } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppLogo } from "@/components/app-logo";
import { supabase } from "@/lib/supabase";
import { setBrandColor } from "@/lib/brand-color";
import { describePeriod, formatCount, formatCurrency, formatDate, formatHours, percentChange, toISODate } from "@/lib/report-utils";
import { monthLabel, parseOutcomes, type OutcomeResult } from "@/lib/outcomes";
import { ChartCard, COLORS, DonutChart, ProgressBar, RankedBarChart, StatGrid, TimeSeriesChart, type StatItem } from "@/components/reports/report-ui";
import { OutcomesReport } from "@/components/reports/outcomes-report";
import { goalTiming } from "@/components/reports/goals-card";
import { Clock, DollarSign, Filter, FileText, HandHeart, KeyRound, Lock, Printer, Users } from "lucide-react";

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
  /** A note shown under each section, by section (migration 020). */
  section_notes?: Record<string, string>;
  /** True when the link counts only some campaigns, programs, forms, etc. */
  filtered?: boolean;
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
  /** Help given (migration 012), when shared. */
  services?: {
    count: number;
    people_helped: number;
    value: number;
    previous: { count: number; people_helped: number; value: number } | null;
    by_type: { name: string; count: number; value: number }[];
    by_month: { month: string; value: number }[];
  };
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

/** Page states. "password" also covers a wrong password (see wrongPassword). */
type PageState = "loading" | "ready" | "unavailable" | "expired" | "locked" | "password";

/** A plain centered card for the states without a report. */
function Notice({ icon: Icon, title, children }: { icon: typeof Lock; title: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <Card className="max-w-md w-full p-8 text-center space-y-3">
        <Icon className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
        <h1 className="text-lg font-semibold">{title}</h1>
        {children}
      </Card>
    </div>
  );
}

export default function FunderReportPage() {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = useState<FunderReport | null>(null);
  const [state, setState] = useState<PageState>("loading");
  const [logoFailed, setLogoFailed] = useState(false);
  /** Names shown before the report itself (password, expired, locked). */
  const [header, setHeader] = useState<{ name: string; organization: string } | null>(null);
  const [password, setPassword] = useState("");
  const [wrongPassword, setWrongPassword] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  // Keep shared reports out of search engines.
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  /** Load the report, with the password if one was entered. */
  const load = useCallback(
    async (withPassword?: string) => {
      const { data, error } = await supabase.rpc("get_funder_report", {
        p_token: token,
        ...(withPassword !== undefined ? { p_password: withPassword } : {}),
      });
      if (error || !data) {
        setState("unavailable");
        return;
      }
      const r = data as FunderReport & { status?: string; wrong_password?: boolean; organization?: { name: string } };
      setHeader({ name: r.name, organization: r.organization?.name ?? "" });
      // Before migration 020 there's no status: it's always a report.
      const status = r.status ?? "ok";
      if (status === "expired") return setState("expired");
      if (status === "locked") return setState("locked");
      if (status === "password_required") {
        setWrongPassword(Boolean(r.wrong_password));
        return setState("password");
      }
      setReport({
        ...r,
        totals: totalsOf(r.totals as unknown as Record<string, unknown>)!,
        previous_totals: totalsOf(r.previous_totals as unknown as Record<string, unknown> | null),
        outcomes: r.outcomes ? parseOutcomes(r.outcomes) : undefined,
      });
      setBrandColor("page", r.organization?.primary_color);
      document.title = `${r.organization?.name ?? "Report"}: ${r.name}`;
      setState("ready");
    },
    [token],
  );

  useEffect(() => {
    load();
    return () => setBrandColor("page", null);
  }, [load]);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || isChecking) return;
    setIsChecking(true);
    await load(password);
    setIsChecking(false);
  };

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

  if (state === "expired") {
    return (
      <Notice icon={Lock} title="This report has expired">
        <p className="text-sm text-muted-foreground">
          {header?.organization ? `${header.organization} set this link to stop working after a certain date.` : "This link has stopped working."}{" "}
          Please contact them if you still need it.
        </p>
      </Notice>
    );
  }

  if (state === "locked") {
    return (
      <Notice icon={Lock} title="Too many tries">
        <p className="text-sm text-muted-foreground">
          The wrong password was entered too many times. Please wait 15 minutes, then try again.
        </p>
      </Notice>
    );
  }

  if (state === "password") {
    return (
      <Notice icon={KeyRound} title={header?.name ?? "Password needed"}>
        <p className="text-sm text-muted-foreground">
          {header?.organization ? `${header.organization} protected this report with a password.` : "This report is protected with a password."}{" "}
          They'll have sent it to you separately from the link.
        </p>
        <form onSubmit={submitPassword} className="space-y-3 text-left">
          <div className="space-y-1.5">
            <Label htmlFor="funder-password">Password</Label>
            <Input
              id="funder-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={wrongPassword}
              aria-describedby={wrongPassword ? "funder-password-error" : undefined}
            />
            {wrongPassword && (
              <p id="funder-password-error" role="alert" className="text-xs text-destructive">
                That password isn't right. Check it and try again.
              </p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={!password || isChecking}>
            {isChecking ? "Checking..." : "View report"}
          </Button>
        </form>
      </Notice>
    );
  }

  if (state === "unavailable" || !report) {
    return (
      <Notice icon={Lock} title="This report isn't available">
        <p className="text-sm text-muted-foreground">
          The link may be mistyped, paused or no longer shared. Please contact the organization that sent it to you.
        </p>
      </Notice>
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

  /** Each section's content, shown in the order chosen for the link. */
  const sectionBodies: Record<string, React.ReactNode> = {
    impact: headline.length > 0 ? <StatGrid stats={headline} compareLabel={compareLabel} /> : null,

    donations: (
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
    ),

    goals:
      report.goals && report.goals.length > 0 ? (
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
      ) : null,

    volunteers: (
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
    ),

    services: report.services ? (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <HandHeart className="h-5 w-5 text-primary" aria-hidden="true" /> Help given
        </h2>
        <StatGrid
          compareLabel={compareLabel}
          stats={[
            { label: "Times help was given", value: formatCount(num(report.services.count)), change: percentChange(num(report.services.count), report.services.previous ? num(report.services.previous.count) : null) },
            { label: "People helped", value: formatCount(num(report.services.people_helped)), change: percentChange(num(report.services.people_helped), report.services.previous ? num(report.services.previous.people_helped) : null) },
            { label: "Value of help", value: formatCurrency(num(report.services.value)), change: percentChange(num(report.services.value), report.services.previous ? num(report.services.previous.value) : null) },
            { label: "Value per person", value: num(report.services.people_helped) ? formatCurrency(num(report.services.value) / num(report.services.people_helped)) : "-" },
          ]}
        />
        <div className="grid md:grid-cols-3 gap-6">
          <ChartCard title="Help given by month" className="md:col-span-2">
            <TimeSeriesChart data={months(report.services.by_month)} kind="bar" color={COLORS[1]} seriesName="Times" />
          </ChartCard>
          <ChartCard title="By type">
            <DonutChart
              data={(report.services.by_type ?? []).map((st) => ({ name: String(st.name), value: num(st.count) }))}
              valueFormatter={(v) => `${v} ${v === 1 ? "time" : "times"}`}
              heightClass="h-36"
            />
          </ChartCard>
        </div>
      </section>
    ) : null,

    outcomes: report.outcomes ? (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Outcomes</h2>
        <OutcomesReport outcomes={report.outcomes} setupHint={false} />
      </section>
    ) : null,

    forms: (
      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Form responses</h2>
        <ChartCard title="Responses by form">
          <RankedBarChart
            seriesName="Responses"
            data={pairs(report.responses_by_form).slice(0, 15).map((r) => ({ label: r.name.length > 18 ? `${r.name.slice(0, 18)}...` : r.name, fullName: r.name, value: r.value }))}
          />
        </ChartCard>
      </section>
    ),
  };

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

        {report.filtered && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Filter className="h-4 w-4 shrink-0" aria-hidden="true" />
            This report counts only the campaigns, programs, forms or goals {org.name} chose to share.
          </p>
        )}

        {/* Without "Headline numbers" as a section, the summary still leads, as before. */}
        {!has("impact") && headline.length > 0 && <StatGrid stats={headline} compareLabel={compareLabel} />}

        {report.sections.map((key) => {
          const body = sectionBodies[key];
          if (!body) return null;
          const note = report.section_notes?.[key]?.trim();
          return (
            <div key={key} className="space-y-3">
              {body}
              {note && <p className="text-sm text-muted-foreground whitespace-pre-line border-l-2 border-primary pl-3">{note}</p>}
            </div>
          );
        })}

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
