/**
 * Building blocks for the Reports page: stat tiles with period comparisons,
 * chart cards and the charts themselves (Recharts).
 *
 * Chart cards carry data-report-chart="<title>", which the PDF export uses
 * to copy the charts on screen into the printed report.
 */

import { useId, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Area,
  AreaChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  Legend,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { formatChange, type NamedValue, type SeriesPoint } from "@/lib/report-utils";

/**
 * Mid-lightness colors that stay readable on both light and dark
 * backgrounds, and in print. Fixed values (not theme variables) so the
 * charts copied into the PDF keep their colors.
 */
export const COLORS = [
  "hsl(217, 78%, 48%)",
  "hsl(160, 62%, 38%)",
  "hsl(35, 92%, 48%)",
  "hsl(340, 70%, 52%)",
  "hsl(265, 58%, 56%)",
  "hsl(190, 78%, 40%)",
  "hsl(15, 78%, 52%)",
];
const OTHER_COLOR = "hsl(220, 9%, 55%)";
export const DANGER_COLOR = "hsl(0, 72%, 51%)";

const AXIS_TICK = { fill: "hsl(var(--muted-foreground))", fontSize: 11 };
const TOOLTIP_STYLE = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  color: "hsl(var(--foreground))",
};

// ===========================================================================
// Stat tiles
// ===========================================================================

export interface StatItem {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  /** Shows the value in red with a warning label, e.g. out-of-stock counts above zero. */
  danger?: boolean;
  /** Change vs. the previous period as a fraction (0.18 = +18%); null hides it. */
  change?: number | null;
  /** Whether going up is good (green). False for things like "out of stock". */
  upIsGood?: boolean;
  /** Small text under the value. */
  sub?: string;
}

function ChangeBadge({ change, upIsGood = true, compareLabel }: { change: number; upIsGood?: boolean; compareLabel: string }) {
  const pct = Math.round(change * 100);
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
  const good = pct === 0 ? null : (pct > 0) === upIsGood;
  const color = good === null ? "text-muted-foreground" : good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
  return (
    <p className={`mt-1 flex items-center gap-1 text-xs ${color}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span>
        {formatChange(change)} <span className="text-muted-foreground">{compareLabel}</span>
      </span>
    </p>
  );
}

/** Grid of headline numbers, each with an optional comparison to the previous period. */
export function StatGrid({ stats, compareLabel }: { stats: StatItem[]; compareLabel?: string }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
            <p className={`text-2xl font-bold ${s.danger ? "text-destructive" : ""}`}>
              {s.value}
              {s.danger && <span className="sr-only"> (needs attention)</span>}
            </p>
            {s.sub && <p className="mt-1 text-xs text-muted-foreground">{s.sub}</p>}
            {s.change != null && compareLabel && (
              <ChangeBadge change={s.change} upIsGood={s.upIsGood} compareLabel={compareLabel} />
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Cards and empty states
// ===========================================================================

/** Card with a heading, used around every chart. `pdf={false}` keeps a chart out of the PDF. */
export function ChartCard({
  title,
  description,
  children,
  className = "",
  pdf = true,
  action,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  pdf?: boolean;
  action?: ReactNode;
}) {
  return (
    <Card className={`p-6 ${className}`} data-report-chart={pdf ? title : undefined}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export function EmptyChart({ message = "No data for this period" }: { message?: string }) {
  return <p className="text-sm text-muted-foreground text-center py-12">{message}</p>;
}

// ===========================================================================
// Charts
// ===========================================================================

/** Area, bar or line chart of a time series, with a text summary for screen readers. */
export function TimeSeriesChart({
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
  // useId returns values with colons, which aren't valid inside url(#...).
  const gradientId = `grad-${useId().replace(/:/g, "")}`;
  if (!data.length || data.every((d) => d.value === 0)) return <EmptyChart />;

  const peak = data.reduce((best, d) => (d.value > best.value ? d : best), data[0]);
  const total = data.reduce((s, d) => s + d.value, 0);
  const summary = `${seriesName} from ${data[0].label} to ${data[data.length - 1].label}: total ${valueFormatter(total)}, highest ${valueFormatter(peak.value)} (${peak.label}).`;

  const tooltip = <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v) => [valueFormatter(Number(v)), seriesName]} />;
  const grid = <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 80%)" strokeOpacity={0.5} />;
  const xAxis = <XAxis dataKey="label" tick={AXIS_TICK} minTickGap={12} />;
  const yAxis = <YAxis tick={AXIS_TICK} tickFormatter={yTickFormatter} width={64} />;

  return (
    <div className={heightClass} role="img" aria-label={summary}>
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
 * Two series on one axis (e.g. this year vs last year), as grouped bars or
 * lines, with a legend. Both series must use the same unit; charts of
 * different measures belong side by side, never on a second axis.
 * The colors are COLORS[0] and COLORS[1], checked for colorblind separation.
 */
export function TwoSeriesChart({
  data,
  kind,
  names,
  valueFormatter = (v) => v.toLocaleString("en-US"),
  yTickFormatter,
  heightClass = "h-56",
}: {
  /** null = no value yet (e.g. a month still to come), drawn as a gap. */
  data: { label: string; a: number | null; b: number | null }[];
  kind: "bar" | "line";
  /** Legend and tooltip names for a and b. */
  names: [string, string];
  valueFormatter?: (v: number) => string;
  yTickFormatter?: (v: number) => string;
  heightClass?: string;
}) {
  if (!data.length || data.every((d) => !d.a && !d.b)) return <EmptyChart />;
  const total = (k: "a" | "b") => data.reduce((s, d) => s + (d[k] ?? 0), 0);
  const summary = `${names[0]}: total ${valueFormatter(total("a"))}. ${names[1]}: total ${valueFormatter(total("b"))}. From ${data[0].label} to ${data[data.length - 1].label}.`;
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 80%)" strokeOpacity={0.5} vertical={false} />
      <XAxis dataKey="label" tick={AXIS_TICK} minTickGap={8} />
      <YAxis tick={AXIS_TICK} tickFormatter={yTickFormatter} width={64} />
      <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => [valueFormatter(Number(v)), String(name)]} />
      <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: "hsl(var(--muted-foreground))" }} />
    </>
  );
  return (
    <div className={heightClass} role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart data={data} barGap={2}>
            {common}
            <Bar dataKey="a" name={names[0]} fill={COLORS[0]} radius={[4, 4, 0, 0]} />
            <Bar dataKey="b" name={names[1]} fill={COLORS[1]} radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={data}>
            {common}
            <Line type="monotone" dataKey="a" name={names[0]} stroke={COLORS[0]} strokeWidth={2} dot={{ r: 4 }} />
            <Line type="monotone" dataKey="b" name={names[1]} stroke={COLORS[1]} strokeWidth={2} dot={{ r: 4 }} strokeDasharray="5 4" />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Name of the slice that collects the smallest values ("Other" is often a real category). */
const FOLDED = "Everything else";

/** Keeps the largest slices and folds the rest into one, so colors never repeat. */
const foldSmallSlices = (data: NamedValue[], keep = COLORS.length): NamedValue[] => {
  if (data.length <= keep) return data;
  const rest = data.slice(keep - 1).reduce((s, d) => s + d.value, 0);
  return [...data.slice(0, keep - 1), { name: FOLDED, value: Math.round(rest * 100) / 100 }];
};

/** Donut chart with a legend that lists every slice's value and share. */
export function DonutChart({
  data,
  valueFormatter = (v) => v.toLocaleString("en-US"),
  heightClass = "h-40",
  showLabels = false,
}: {
  data: NamedValue[];
  valueFormatter?: (v: number) => string;
  heightClass?: string;
  showLabels?: boolean;
}) {
  if (!data.length) return <EmptyChart />;
  const slices = foldSmallSlices(data);
  const total = slices.reduce((s, d) => s + d.value, 0);
  const folded = data.length > slices.length;
  const colorOf = (i: number) => (folded && i === slices.length - 1 ? OTHER_COLOR : COLORS[i % COLORS.length]);

  return (
    <>
      <div className={heightClass} aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              cx="50%"
              cy="50%"
              innerRadius="50%"
              outerRadius="85%"
              dataKey="value"
              nameKey="name"
              paddingAngle={2}
              label={showLabels ? ({ percent }) => `${Math.round((percent ?? 0) * 100)}%` : undefined}
            >
              {slices.map((entry, i) => (
                <Cell key={entry.name} fill={colorOf(i)} />
              ))}
            </Pie>
            <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => [valueFormatter(Number(v)), name]} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      {/* The legend is the accessible version of the chart: every value as text. */}
      <ul className="space-y-1 mt-3">
        {slices.map((d, i) => (
          <li key={d.name} className="flex items-center justify-between text-xs gap-2">
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: colorOf(i) }} aria-hidden="true" />
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
      </ul>
    </>
  );
}

/** Horizontal bars, for ranked lists like top volunteers or responses per form. Labels never collide. */
export function RankedBarChart({
  data,
  valueFormatter = (v) => v.toLocaleString("en-US"),
  seriesName,
  color = COLORS[0],
}: {
  data: { label: string; fullName: string; value: number; color?: string }[];
  valueFormatter?: (v: number) => string;
  seriesName: string;
  color?: string;
}) {
  if (!data.length || data.every((d) => d.value === 0)) return <EmptyChart />;
  const summary = `${seriesName}: ${data
    .slice(0, 5)
    .map((d) => `${d.fullName} ${valueFormatter(d.value)}`)
    .join(", ")}${data.length > 5 ? `, and ${data.length - 5} more` : ""}.`;

  return (
    <div style={{ height: Math.max(data.length * 32 + 40, 120) }} role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 13%, 80%)" strokeOpacity={0.5} horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={120} tick={AXIS_TICK} interval={0} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
            formatter={(v) => [valueFormatter(Number(v)), seriesName]}
          />
          <Bar dataKey="value" name={seriesName} fill={color} radius={[0, 4, 4, 0]}>
            {data.map((d) => (
              <Cell key={d.fullName} fill={d.color ?? color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A labeled progress bar, e.g. for fundraising goals. */
export function ProgressBar({ value, max, color }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div
      className="h-2.5 w-full rounded-full bg-muted overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color ?? COLORS[1] }} />
    </div>
  );
}
