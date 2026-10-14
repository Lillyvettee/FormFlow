/**
 * Funder portals (migration 010): private links to a live, read-only report
 * for a funder or grant. Opened from the Reports page.
 *
 * Funders see totals, trends, goals and outcomes only, never names,
 * contact details or individual answers (see get_funder_report). Owners and
 * admins create, pause and delete links; other members can see and copy them.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { friendlyWriteError } from "@/lib/db-errors";
import { formatDate, toISODate } from "@/lib/report-utils";
import { Check, Copy, ExternalLink, Pause, Play, Plus, ShieldCheck, Trash2 } from "lucide-react";

export const FUNDER_SECTIONS = [
  { value: "impact", label: "Headline numbers" },
  { value: "donations", label: "Donations" },
  { value: "volunteers", label: "Volunteer hours" },
  { value: "forms", label: "Form responses (counts)" },
  { value: "goals", label: "Fundraising goals" },
  { value: "outcomes", label: "Outcomes" },
  { value: "services", label: "Help given (totals and types)" },
] as const;
export type FunderSection = (typeof FUNDER_SECTIONS)[number]["value"];

export const FUNDER_PERIODS = [
  { value: "this_year", label: "This year (updates automatically)" },
  { value: "last_12_months", label: "Last 12 months (updates automatically)" },
  { value: "last_year", label: "Last year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom dates (e.g. a grant period)" },
] as const;

interface Share {
  id: string;
  name: string;
  message: string | null;
  sections: FunderSection[];
  period: (typeof FUNDER_PERIODS)[number]["value"];
  date_from: string | null;
  date_to: string | null;
  token: string;
  created_at: string;
  revoked_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
}

export const funderLink = (token: string) => `${window.location.origin}/share/${token}`;

const periodText = (s: Pick<Share, "period" | "date_from" | "date_to">) =>
  s.period === "custom" && s.date_from && s.date_to
    ? `${formatDate(s.date_from)} to ${formatDate(s.date_to)}`
    : FUNDER_PERIODS.find((p) => p.value === s.period)?.label.replace(/ \(.*\)$/, "") ?? s.period;

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          window.prompt("Copy this link:", text);
        }
      }}
    >
      {copied ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

function NewShareForm({ onCreated, onCancel }: { onCreated: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const y = new Date().getFullYear();
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [period, setPeriod] = useState<Share["period"]>("this_year");
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(toISODate(new Date()));
  const [sections, setSections] = useState<FunderSection[]>(FUNDER_SECTIONS.map((s) => s.value));
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const errors = {
    name: name.trim() ? null : "Give the link a name, e.g. the funder or grant.",
    sections: sections.length ? null : "Choose at least one section.",
    dates: period === "custom" && (!from || !to || to < from) ? "Choose a start date and a later end date." : null,
  };

  const create = async () => {
    setShowErrors(true);
    if (Object.values(errors).some(Boolean) || isSaving) return;
    setIsSaving(true);
    const { error } = await supabase.from("funder_shares").insert({
      name: name.trim(),
      message: message.trim() || null,
      sections,
      period,
      date_from: period === "custom" ? from : null,
      date_to: period === "custom" ? to : null,
    });
    setIsSaving(false);
    if (error) {
      // "Help given" needs migration 012; until then the database doesn't accept that section.
      const needsUpdate = sections.includes("services") && /sections_check/.test(error.message ?? "");
      toast({
        title: "Couldn't create the link",
        description: needsUpdate
          ? "Sharing help given needs a database update (012_services_and_case_notes.sql). Untick Help given, or run the update first."
          : friendlyWriteError(error),
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Funder link created", description: "Copy it and send it to your funder." });
    onCreated();
  };

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="space-y-1.5">
        <Label htmlFor="share-name">Name</Label>
        <Input id="share-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. United Way 2026 grant report" maxLength={150} autoFocus />
        {showErrors && errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
        <p className="text-xs text-muted-foreground">The funder sees this as the report's title.</p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="share-message">Note to the funder (optional)</Label>
        <Textarea id="share-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} rows={3} placeholder="e.g. Thank you for supporting our youth program. Here's our progress this year." />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="share-period">Period</Label>
        <Select value={period} onValueChange={(v) => setPeriod(v as Share["period"])}>
          <SelectTrigger id="share-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FUNDER_PERIODS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {period === "custom" && (
          <div className="grid grid-cols-2 gap-3 pt-1">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Start date" />
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="End date" />
          </div>
        )}
        {showErrors && errors.dates && <p className="text-xs text-destructive">{errors.dates}</p>}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What the funder sees</legend>
        <div className="grid sm:grid-cols-2 gap-2">
          {FUNDER_SECTIONS.map((s) => (
            <label key={s.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={sections.includes(s.value)}
                onCheckedChange={(on) => setSections((cur) => (on ? [...cur, s.value] : cur.filter((x) => x !== s.value)))}
              />
              {s.label}
            </label>
          ))}
        </div>
        {showErrors && errors.sections && <p className="text-xs text-destructive">{errors.sections}</p>}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={create} disabled={isSaving}>
          {isSaving ? "Creating..." : "Create link"}
        </Button>
      </div>
    </div>
  );
}

export function FunderSharesDialog({ onClose }: { onClose: () => void }) {
  const { isAdmin } = useOrganization();
  const { toast } = useToast();
  const [shares, setShares] = useState<Share[] | null>(null);
  const [missing, setMissing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("funder_shares").select("*").order("created_at", { ascending: false });
    if (error) {
      if (["PGRST205", "42P01"].includes(error.code ?? "")) setMissing(true);
      else toast({ title: "Couldn't load funder links", description: error.message, variant: "destructive" });
      setShares([]);
      return;
    }
    setShares(data ?? []);
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const setPaused = async (s: Share, paused: boolean) => {
    const { error } = await supabase.from("funder_shares").update({ revoked_at: paused ? new Date().toISOString() : null }).eq("id", s.id);
    if (error) toast({ title: "Couldn't update the link", description: friendlyWriteError(error), variant: "destructive" });
    else load();
  };

  const remove = async (s: Share) => {
    if (!window.confirm(`Delete "${s.name}"? The funder's link stops working for good.`)) return;
    const { error } = await supabase.from("funder_shares").delete().eq("id", s.id);
    if (error) toast({ title: "Couldn't delete the link", description: friendlyWriteError(error), variant: "destructive" });
    else load();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Funder portals</DialogTitle>
          <DialogDescription>
            Private links to a live report for a funder or grant. It updates as you add records, with no sign-in needed.
          </DialogDescription>
        </DialogHeader>

        <p className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          Funders see totals, trends, goals and outcomes only. Never names, contact details or individual answers. Anyone with
          the link can view it, so send it only to the funder. Pause or delete it any time.
        </p>

        {missing ? (
          <p className="text-sm text-muted-foreground">
            Funder portals need a database update: run <code className="font-mono text-xs">010_people_outcomes_funder_portals.sql</code> in the
            Supabase SQL Editor.
          </p>
        ) : (
          <div className="space-y-4">
            {isAdmin &&
              (creating ? (
                <NewShareForm onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); load(); }} />
              ) : (
                <Button onClick={() => setCreating(true)}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> New funder link
                </Button>
              ))}

            {shares === null ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : shares.length === 0 ? (
              !creating && <p className="text-sm text-muted-foreground">No funder links yet.{isAdmin ? "" : " Ask an owner or admin to create one."}</p>
            ) : (
              <ul className="space-y-3">
                {shares.map((s) => {
                  const paused = Boolean(s.revoked_at);
                  return (
                    <li key={s.id} className={`rounded-md border p-4 space-y-2 ${paused ? "opacity-70" : ""}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium flex flex-wrap items-center gap-2">
                            {s.name}
                            {paused && <Badge variant="outline">Paused</Badge>}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {periodText(s)} · {s.sections.map((x) => FUNDER_SECTIONS.find((f) => f.value === x)?.label ?? x).join(", ")}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {s.view_count
                              ? `Viewed ${s.view_count} ${s.view_count === 1 ? "time" : "times"}, last ${new Date(s.last_viewed_at!).toLocaleDateString("en-US")}`
                              : "Not viewed yet"}
                          </p>
                        </div>
                        {isAdmin && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setPaused(s, !paused)} aria-label={paused ? `Turn on ${s.name}` : `Pause ${s.name}`}>
                              {paused ? <Play className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
                              {paused ? "Turn on" : "Pause"}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(s)} aria-label={`Delete ${s.name}`}>
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </div>
                      {!paused && (
                        <div className="flex flex-wrap gap-2">
                          <CopyButton text={funderLink(s.token)} />
                          <Button asChild size="sm" variant="outline">
                            <a href={funderLink(s.token)} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Preview
                            </a>
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
