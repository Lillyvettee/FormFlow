/**
 * Outcome results (migration 010), used by the Reports page's Outcomes tab
 * and by funder portals.
 *
 * For each question marked "Track as an outcome": how many people were
 * measured, the average first vs. latest score among people measured more
 * than once, how many improved, and the average score per month.
 */

import { Card } from "@/components/ui/card";
import { ChartCard, StatGrid, TimeSeriesChart } from "@/components/reports/report-ui";
import { formatCount } from "@/lib/report-utils";
import { formatScore, improvedPercent, monthLabel, type OutcomeResult } from "@/lib/outcomes";
import { ArrowRight, TrendingUp } from "lucide-react";

/** Improved / same / worse as one stacked bar, with the numbers in text too. */
function ChangeBar({ o }: { o: OutcomeResult }) {
  const total = o.people_with_followup;
  if (!total) return null;
  const parts = [
    { label: "Improved", n: o.improved, color: "hsl(160, 62%, 38%)" },
    { label: "No change", n: o.same, color: "hsl(220, 9%, 65%)" },
    { label: "Declined", n: o.worse, color: "hsl(0, 72%, 55%)" },
  ];
  return (
    <div className="space-y-1.5">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {parts.map((p) => (p.n ? <div key={p.label} style={{ width: `${(p.n / total) * 100}%`, backgroundColor: p.color }} /> : null))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: p.color }} aria-hidden="true" />
            {p.label}: <strong>{formatCount(p.n)}</strong> ({Math.round((p.n / total) * 100)}%)
          </li>
        ))}
      </ul>
    </div>
  );
}

export function OutcomeCard({ o, showForm = true }: { o: OutcomeResult; showForm?: boolean }) {
  const pct = improvedPercent(o);
  return (
    <ChartCard
      title={o.label}
      description={`${showForm ? `${o.form_title} · ` : ""}${o.better_when === "lower" ? "Lower is better" : "Higher is better"}`}
    >
      <div className="space-y-4">
        {o.people_with_followup > 0 ? (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Average first</p>
                <p className="text-lg font-bold">{formatScore(o, o.average_first)}</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Average latest</p>
                <p className="text-lg font-bold">{formatScore(o, o.average_latest)}</p>
              </div>
              {pct != null && (
                <p className="ml-auto text-sm">
                  <strong className="text-emerald-600 dark:text-emerald-400">{pct}%</strong> improved
                </p>
              )}
            </div>
            <ChangeBar o={o} />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {o.people_measured
              ? "Nobody has a second check-in yet. Results appear once people answer again."
              : "No one has answered this through a personal link in this period."}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {formatCount(o.people_measured)} {o.people_measured === 1 ? "person" : "people"} measured,{" "}
          {formatCount(o.people_with_followup)} more than once.
        </p>
        {o.trend.length > 1 && (
          <TimeSeriesChart
            kind="line"
            seriesName="Average score"
            heightClass="h-36"
            data={o.trend.map((t) => ({ key: t.month, label: monthLabel(t.month), value: t.average }))}
            valueFormatter={(v) => formatScore(o, v)}
          />
        )}
      </div>
    </ChartCard>
  );
}

/** The whole Outcomes view: summary tiles and one card per outcome question. */
export function OutcomesReport({ outcomes, setupHint = true }: { outcomes: OutcomeResult[]; setupHint?: boolean }) {
  if (!outcomes.length) {
    return setupHint ? (
      <Card className="p-8 space-y-3 text-center">
        <TrendingUp className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
        <p className="font-medium">Show how the people you serve are doing over time</p>
        <ol className="text-sm text-muted-foreground space-y-1 max-w-lg mx-auto text-left list-decimal pl-5">
          <li>On a check-in form, open a number or dropdown question and turn on "Track as an outcome".</li>
          <li>Add the people you serve on the People page.</li>
          <li>Send each person their personal link, at the start and again later (e.g. every 3 months).</li>
        </ol>
        <p className="text-sm text-muted-foreground">Results here compare each person's first and latest answers.</p>
      </Card>
    ) : (
      <p className="text-sm text-muted-foreground">No outcome results for this period.</p>
    );
  }

  const followup = outcomes.reduce((s, o) => s + o.people_with_followup, 0);
  const improved = outcomes.reduce((s, o) => s + o.improved, 0);
  const mostMeasured = Math.max(...outcomes.map((o) => o.people_measured));

  return (
    <div className="space-y-6">
      <StatGrid
        stats={[
          { label: "Outcome questions", value: formatCount(outcomes.length) },
          { label: "People measured", value: formatCount(mostMeasured), sub: "On the most-answered question" },
          { label: "Measured more than once", value: formatCount(Math.max(...outcomes.map((o) => o.people_with_followup))) },
          { label: "Improved", value: followup ? `${Math.round((improved / followup) * 100)}%` : "-", sub: "Across all outcome questions" },
        ]}
      />
      <div className="grid md:grid-cols-2 gap-6">
        {outcomes.map((o) => (
          <OutcomeCard key={`${o.form_id}:${o.field_id}`} o={o} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Includes people with a check-in in this period, comparing their first check-in ever with their latest. Only responses
        sent through personal links count.
      </p>
    </div>
  );
}
