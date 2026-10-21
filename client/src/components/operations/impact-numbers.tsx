/**
 * ImpactNumbers
 *
 * Grant readiness > Impact numbers (migration 025): the figures grant
 * applications ask for, for a chosen period, each with a copy button and a
 * ready-to-paste sentence. Comparisons are with the same number of days just
 * before. Volunteer time is valued at the rate entered here (shared with the
 * Volunteer Hours page).
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/lib/supabase";
import { formatDate, toISODate } from "@/lib/report-utils";
import {
  PERIOD_PRESETS,
  VOLUNTEER_RATE_KEY,
  buildFigures,
  normalizeNumbers,
  periodDates,
  type GrantNumbers,
  type PeriodPreset,
} from "@/lib/grants";
import { Check, Copy } from "lucide-react";

/** Copies text, with a fallback for browsers that block the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copy this text:", text);
    return false;
  }
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="h-7 px-2 text-xs"
      onClick={async () => {
        if (await copyText(text)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }
      }}
    >
      {copied ? <Check className="mr-1 h-3 w-3" aria-hidden="true" /> : <Copy className="mr-1 h-3 w-3" aria-hidden="true" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

/** "So far in 2026", "From March 1, 2026 to June 30, 2026", ... for sentences. */
export function grantPeriodText(preset: PeriodPreset, dates: { from: string | null; to: string }): string {
  const y = Number(dates.to.slice(0, 4));
  if (preset === "this_year") return `So far in ${y}`;
  if (preset === "last_year") return `In ${y}`;
  if (preset === "last_12_months") return "In the last 12 months";
  if (!dates.from) return "To date";
  return `From ${formatDate(dates.from)} to ${formatDate(dates.to)}`;
}

/** The volunteer hourly value saved on this device, or null. */
export function savedVolunteerRate(): number | null {
  try {
    const v = parseFloat(localStorage.getItem(VOLUNTEER_RATE_KEY) ?? "");
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function ImpactNumbers() {
  const y = new Date().getFullYear();
  const [preset, setPreset] = useState<PeriodPreset>("this_year");
  const [custom, setCustom] = useState({ from: `${y}-01-01`, to: toISODate(new Date()) });
  const [rateText, setRateText] = useState(() => String(savedVolunteerRate() ?? ""));
  const [numbers, setNumbers] = useState<GrantNumbers | null>(null);
  const [error, setError] = useState("");
  const dates = periodDates(preset, custom);

  useEffect(() => {
    if (preset === "custom" && (!custom.from || !custom.to || custom.to < custom.from)) return;
    let cancelled = false;
    setNumbers(null);
    setError("");
    supabase.rpc("get_grant_numbers", { p_from: dates.from, p_to: dates.to }).then(({ data, error: e }) => {
      if (cancelled) return;
      if (e) setError(e.message);
      else setNumbers(normalizeNumbers(data as GrantNumbers));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates.from, dates.to]);

  const rate = parseFloat(rateText);
  const saveRate = (v: string) => {
    setRateText(v);
    try {
      localStorage.setItem(VOLUNTEER_RATE_KEY, v);
    } catch {
      // Remembering the rate is a convenience only.
    }
  };

  const periodText = grantPeriodText(preset, dates);
  const figures = numbers ? buildFigures(numbers, periodText, Number.isFinite(rate) && rate > 0 ? rate : null) : [];
  const allText = figures.map((f) => f.sentence).join(" ");

  return (
    <div className="space-y-5">
      <Card className="p-4 flex flex-wrap items-end gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="grant-period">Period</Label>
          <Select value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
            <SelectTrigger id="grant-period" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {preset === "custom" && (
          <div className="flex gap-2">
            <Input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} aria-label="Start date" />
            <Input type="date" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} aria-label="End date" />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="grant-rate">Volunteer hour value ($)</Label>
          <Input id="grant-rate" type="number" min={0} step="0.01" value={rateText} onChange={(e) => saveRate(e.target.value)} placeholder="e.g. 34.79" className="w-36" />
        </div>
        <p className="text-xs text-muted-foreground max-w-xs">
          Many funders accept Independent Sector's yearly value of volunteer time; use the rate your funder asks for.
        </p>
      </Card>

      {error ? (
        <Card role="alert" className="p-4 text-sm text-destructive">
          {/function .* does not exist|PGRST202/i.test(error) ? "Grant readiness needs a database update: run 025_grants_and_sops.sql." : error}
        </Card>
      ) : !numbers ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : figures.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground">No records in this period yet.</Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {periodText}. Copy a number, a sentence, or everything at once.
            </p>
            <CopyButton text={allText} label="Copy all sentences" />
          </div>
          <ul className="grid gap-3 md:grid-cols-2">
            {figures.map((fig) => (
              <li key={fig.key}>
                <Card className="p-4 space-y-2 h-full">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground">{fig.label}</p>
                      <p className="text-2xl font-bold tabular-nums">{fig.value}</p>
                    </div>
                    <CopyButton text={fig.value} />
                  </div>
                  <div className="flex items-start justify-between gap-2 rounded-md bg-muted/50 p-2">
                    <p className="text-sm">{fig.sentence}</p>
                    <CopyButton text={fig.sentence} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            People served counts anyone with help given or a form response linked to them. Outcomes count people measured more than once.
            Sample data is left out.
          </p>
        </>
      )}
    </div>
  );
}
