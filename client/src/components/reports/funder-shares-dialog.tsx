/**
 * Funder portals (migrations 010 and 020): private links to a live, read-only
 * report for a funder or grant. Opened from the Reports page.
 *
 * Funders see totals, trends, goals and outcomes only, never names,
 * contact details or individual answers (see get_funder_report). Owners and
 * admins create, edit, pause and delete links; other members can see and
 * copy them.
 *
 * Every plan: name, note, period and sections, and editing a link later.
 * Mission and Enterprise (plan feature funderAdvanced, also enforced by the
 * database): filters for what's counted, section order and notes, showing
 * the organization's branding, an expiry date and a password.
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
import { fetchAll, formatDate, toISODate } from "@/lib/report-utils";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Pause,
  Pencil,
  Play,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";

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

/**
 * What a link counts. Keys match funder_filter() in migration 020. An empty
 * or missing list means "everything". Campaigns, activities and programs are
 * stored as written; the database compares them ignoring case, and "" means
 * records with none set.
 */
export interface FunderFilters {
  campaigns?: string[];
  activities?: string[];
  programs?: string[];
  form_ids?: string[];
  goal_ids?: string[];
  /** "<form id>:<question id>" */
  outcomes?: string[];
}

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
  // Migration 020; missing before it runs.
  filters?: FunderFilters;
  section_notes?: Partial<Record<FunderSection, string>>;
  show_branding?: boolean;
  expires_at?: string | null;
  password_protected?: boolean;
}

export const funderLink = (token: string) => `${window.location.origin}/share/${token}`;

const sectionLabel = (value: string) => FUNDER_SECTIONS.find((f) => f.value === value)?.label ?? value;

const periodText = (s: Pick<Share, "period" | "date_from" | "date_to">) =>
  s.period === "custom" && s.date_from && s.date_to
    ? `${formatDate(s.date_from)} to ${formatDate(s.date_to)}`
    : FUNDER_PERIODS.find((p) => p.value === s.period)?.label.replace(/ \(.*\)$/, "") ?? s.period;

const filterCount = (f: FunderFilters | undefined) =>
  Object.values(f ?? {}).filter((v) => Array.isArray(v) && v.length > 0).length;

const isExpired = (s: Share) => Boolean(s.expires_at && new Date(s.expires_at) < new Date());

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

// ---------------------------------------------------------------------------
// Filter choices
// ---------------------------------------------------------------------------

interface Choice {
  value: string;
  label: string;
}

interface FilterChoices {
  campaigns: Choice[];
  activities: Choice[];
  programs: Choice[];
  forms: Choice[];
  goals: Choice[];
  outcomes: Choice[];
}

/** Distinct, case-insensitive values of a text column, with "" labeled as `blank`. */
function distinctChoices(values: (string | null)[], blank: string): Choice[] {
  const seen = new Map<string, string>();
  for (const v of values) {
    const trimmed = (v ?? "").trim();
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()]
    .map((v) => ({ value: v, label: v || blank }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Everything a link can be filtered by. Failures just leave a list empty. */
async function loadFilterChoices(): Promise<FilterChoices> {
  const safe = async <T,>(p: Promise<T[]>): Promise<T[]> => p.catch(() => []);
  const [donations, hours, people, forms, goals] = await Promise.all([
    safe(fetchAll<{ campaign: string | null }>((f, t) => supabase.from("donations").select("campaign").eq("is_sample", false).range(f, t))),
    safe(fetchAll<{ activity: string | null }>((f, t) => supabase.from("volunteer_hours").select("activity").eq("is_sample", false).range(f, t))),
    safe(fetchAll<{ program: string | null }>((f, t) => supabase.from("people").select("program").range(f, t))),
    safe(
      fetchAll<{ id: string; title: string; fields: { id: string; label?: string; outcome?: unknown }[] | null }>((f, t) =>
        supabase.from("forms").select("id, title, fields").eq("is_sample", false).eq("is_archived", false).order("title").range(f, t),
      ),
    ),
    safe(fetchAll<{ id: string; name: string }>((f, t) => supabase.from("fundraising_goals").select("id, name").order("end_date", { ascending: false }).range(f, t))),
  ]);
  return {
    campaigns: distinctChoices(donations.map((d) => d.campaign), "General (no campaign)"),
    activities: distinctChoices(hours.map((h) => h.activity), "Other (no activity)"),
    programs: distinctChoices(people.map((p) => p.program), "No program"),
    forms: forms.map((f) => ({ value: f.id, label: f.title || "Untitled form" })),
    goals: goals.map((g) => ({ value: g.id, label: g.name })),
    outcomes: forms.flatMap((f) =>
      (f.fields ?? [])
        .filter((fld) => fld.outcome && typeof fld.outcome === "object")
        .map((fld) => ({ value: `${f.id}:${fld.id}`, label: `${f.title}: ${fld.label || "Untitled question"}` })),
    ),
  };
}

/** One filter: a checkbox list. Nothing ticked means everything counts. */
function FilterList({
  label,
  hint,
  choices,
  selected,
  onChange,
  disabled,
}: {
  label: string;
  hint: string;
  choices: Choice[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  if (choices.length === 0) return null;
  const isOn = (v: string) => selected.some((s) => s.toLowerCase() === v.toLowerCase());
  return (
    <fieldset className="space-y-1.5" disabled={disabled}>
      <legend className="text-sm font-medium">{label}</legend>
      <p className="text-xs text-muted-foreground">
        {selected.length ? `${selected.length} chosen. ` : "All counted. "}
        {hint}
      </p>
      <div className="max-h-36 overflow-y-auto rounded-md border p-2 grid sm:grid-cols-2 gap-1.5">
        {choices.map((c) => (
          <label key={c.value} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={isOn(c.value)}
              onCheckedChange={(on) =>
                onChange(on ? [...selected, c.value] : selected.filter((s) => s.toLowerCase() !== c.value.toLowerCase()))
              }
            />
            <span className="truncate" title={c.label}>
              {c.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Shown on Starter where an advanced option would be. */
function UpgradeNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-muted-foreground">
      {children} Included with the Mission and Enterprise plans.{" "}
      <a href="/settings#plan" className="underline hover:text-foreground">
        See plans
      </a>
    </p>
  );
}

// ---------------------------------------------------------------------------
// Create / edit form
// ---------------------------------------------------------------------------

function ShareForm({ share, onSaved, onCancel }: { share?: Share; onSaved: () => void; onCancel: () => void }) {
  const { toast } = useToast();
  const { plan } = useOrganization();
  const advanced = plan.features.funderAdvanced;
  const y = new Date().getFullYear();

  const [name, setName] = useState(share?.name ?? "");
  const [message, setMessage] = useState(share?.message ?? "");
  const [period, setPeriod] = useState<Share["period"]>(share?.period ?? "this_year");
  const [from, setFrom] = useState(share?.date_from ?? `${y}-01-01`);
  const [to, setTo] = useState(share?.date_to ?? toISODate(new Date()));
  /** Chosen sections, in the order the funder sees them. */
  const [sections, setSections] = useState<FunderSection[]>(share?.sections ?? FUNDER_SECTIONS.map((s) => s.value));
  const [notes, setNotes] = useState<Partial<Record<FunderSection, string>>>(share?.section_notes ?? {});
  const [filters, setFilters] = useState<FunderFilters>(share?.filters ?? {});
  const [showBranding, setShowBranding] = useState(share?.show_branding ?? true);
  const [expires, setExpires] = useState(share?.expires_at ? toISODate(new Date(share.expires_at)) : "");
  /** "" = leave as is; for a new link, "" = no password. */
  const [password, setPassword] = useState("");
  const [removePassword, setRemovePassword] = useState(false);

  const [choices, setChoices] = useState<FilterChoices | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (advanced) loadFilterChoices().then(setChoices);
  }, [advanced]);

  const errors = {
    name: name.trim() ? null : "Give the link a name, e.g. the funder or grant.",
    sections: sections.length ? null : "Choose at least one section.",
    dates: period === "custom" && (!from || !to || to < from) ? "Choose a start date and a later end date." : null,
    password: password && (password.length < 6 || password.length > 100) ? "Use 6 to 100 characters." : null,
    expires: expires && expires < toISODate(new Date()) ? "Choose today or a later date." : null,
  };

  /** Sections in display order: chosen ones first (in their order), then the rest. */
  const orderedSections = [
    ...sections.map((v) => FUNDER_SECTIONS.find((s) => s.value === v)!).filter(Boolean),
    ...FUNDER_SECTIONS.filter((s) => !sections.includes(s.value)),
  ];
  const move = (value: FunderSection, by: -1 | 1) =>
    setSections((cur) => {
      const i = cur.indexOf(value);
      const j = i + by;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const setFilter = (key: keyof FunderFilters) => (next: string[]) => setFilters((f) => ({ ...f, [key]: next }));

  const save = async () => {
    setShowErrors(true);
    if (Object.values(errors).some(Boolean) || isSaving) return;
    setIsSaving(true);

    const cleanNotes = Object.fromEntries(
      Object.entries(notes).filter(([k, v]) => v?.trim() && sections.includes(k as FunderSection)).map(([k, v]) => [k, v!.trim()]),
    );
    const cleanFilters = Object.fromEntries(Object.entries(filters).filter(([, v]) => Array.isArray(v) && v.length > 0));
    const row = {
      name: name.trim(),
      message: message.trim() || null,
      sections,
      period,
      date_from: period === "custom" ? from : null,
      date_to: period === "custom" ? to : null,
      // Advanced settings are only sent on plans that include them, so Starter
      // can still edit links made while on a bigger plan.
      ...(advanced
        ? {
            filters: cleanFilters,
            section_notes: cleanNotes,
            show_branding: showBranding,
            // End of the chosen day, in the viewer's time zone.
            expires_at: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
          }
        : {}),
    };

    const res = share
      ? await supabase.from("funder_shares").update(row).eq("id", share.id).select("id").single()
      : await supabase.from("funder_shares").insert(row).select("id").single();
    if (res.error) {
      setIsSaving(false);
      toast({ title: share ? "Couldn't save the link" : "Couldn't create the link", description: friendlyWriteError(res.error), variant: "destructive" });
      return;
    }

    // Password: its own call, because it's stored apart from the link (migration 020).
    if (advanced && (password || removePassword)) {
      const { error } = await supabase.rpc("set_funder_share_password", {
        p_share_id: res.data.id,
        p_password: removePassword ? null : password,
      });
      if (error) {
        setIsSaving(false);
        toast({ title: "The link was saved, but the password wasn't", description: error.message, variant: "destructive" });
        onSaved();
        return;
      }
    }

    setIsSaving(false);
    toast({
      title: share ? "Link saved" : "Funder link created",
      description: share ? "The funder sees the changes next time they open it." : "Copy it and send it to your funder.",
    });
    onSaved();
  };

  return (
    <div className="space-y-5 rounded-md border p-4">
      <h3 className="font-medium">{share ? `Edit "${share.name}"` : "New funder link"}</h3>

      {/* ----- Basics (every plan) ----- */}
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

      {/* ----- Sections: which, in what order, with notes ----- */}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What the funder sees</legend>
        <p className="text-xs text-muted-foreground">
          {advanced ? "Tick the sections to include, use the arrows to change their order, and add a note under any of them." : "Tick the sections to include."}
        </p>
        <ul className="space-y-2">
          {orderedSections.map((s) => {
            const on = sections.includes(s.value);
            const i = sections.indexOf(s.value);
            return (
              <li key={s.value} className={`rounded-md ${on && advanced ? "border p-2" : ""}`}>
                <div className="flex items-center gap-2">
                  <label className="flex flex-1 items-center gap-2 text-sm">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(checked) => setSections((cur) => (checked ? [...cur, s.value] : cur.filter((x) => x !== s.value)))}
                    />
                    {s.label}
                  </label>
                  {on && advanced && (
                    <span className="flex">
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={i === 0} onClick={() => move(s.value, -1)} aria-label={`Move ${s.label} up`}>
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" disabled={i === sections.length - 1} onClick={() => move(s.value, 1)} aria-label={`Move ${s.label} down`}>
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </span>
                  )}
                </div>
                {on && advanced && (
                  <Textarea
                    value={notes[s.value] ?? ""}
                    onChange={(e) => setNotes((n) => ({ ...n, [s.value]: e.target.value }))}
                    maxLength={1000}
                    rows={2}
                    placeholder={`Optional note shown under ${s.label.toLowerCase()}`}
                    aria-label={`Note for ${s.label}`}
                    className="mt-2 text-sm"
                  />
                )}
              </li>
            );
          })}
        </ul>
        {showErrors && errors.sections && <p className="text-xs text-destructive">{errors.sections}</p>}
        {!advanced && <UpgradeNote>Reordering sections and adding a note to each is a Mission feature.</UpgradeNote>}
      </fieldset>

      {/* ----- Filters ----- */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Filter what's counted</h4>
        {!advanced ? (
          <UpgradeNote>Count only certain campaigns, programs, forms, goals or outcomes.</UpgradeNote>
        ) : !choices ? (
          <p className="text-xs text-muted-foreground">Loading choices...</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Leave a list empty to count everything in it.</p>
            <FilterList label="Donation campaigns" hint="Donation totals, charts and the headline amount." choices={choices.campaigns} selected={filters.campaigns ?? []} onChange={setFilter("campaigns")} disabled={isSaving} />
            <FilterList label="Volunteer activities" hint="Volunteer hours and the headline hours." choices={choices.activities} selected={filters.activities ?? []} onChange={setFilter("activities")} disabled={isSaving} />
            <FilterList label="Programs" hint="People served, outcomes and help given." choices={choices.programs} selected={filters.programs ?? []} onChange={setFilter("programs")} disabled={isSaving} />
            <FilterList label="Forms" hint="Form responses, people served and outcomes." choices={choices.forms} selected={filters.form_ids ?? []} onChange={setFilter("form_ids")} disabled={isSaving} />
            <FilterList label="Fundraising goals" hint="Which goals are shown." choices={choices.goals} selected={filters.goal_ids ?? []} onChange={setFilter("goal_ids")} disabled={isSaving} />
            <FilterList label="Outcome questions" hint="Which outcome results are shown." choices={choices.outcomes} selected={filters.outcomes ?? []} onChange={setFilter("outcomes")} disabled={isSaving} />
          </>
        )}
      </div>

      {/* ----- Look and access ----- */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium">Look and access</h4>
        {!advanced ? (
          <UpgradeNote>Your logo and color, an expiry date and a password.</UpgradeNote>
        ) : (
          <>
            {plan.features.branding && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={showBranding} onCheckedChange={(on) => setShowBranding(on === true)} />
                Show our logo and color (from Settings &gt; Branding)
              </label>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="share-expires">Stops working after (optional)</Label>
              <Input id="share-expires" type="date" value={expires} min={toISODate(new Date())} onChange={(e) => setExpires(e.target.value)} className="max-w-[12rem]" />
              {showErrors && errors.expires && <p className="text-xs text-destructive">{errors.expires}</p>}
              <p className="text-xs text-muted-foreground">Leave empty to keep it working until you pause or delete it.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="share-password">
                {share?.password_protected ? "Change password (optional)" : "Password (optional)"}
              </Label>
              <Input
                id="share-password"
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={removePassword}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={share?.password_protected ? "Leave empty to keep the current password" : "Leave empty for no password"}
                maxLength={100}
                className="max-w-sm"
              />
              {showErrors && errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
              {share?.password_protected && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={removePassword} onCheckedChange={(on) => { setRemovePassword(on === true); setPassword(""); }} />
                  Remove the password
                </label>
              )}
              <p className="text-xs text-muted-foreground">Send the password to the funder separately from the link. It can't be shown again later.</p>
            </div>
          </>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={isSaving}>
          Cancel
        </Button>
        <Button onClick={save} disabled={isSaving}>
          {isSaving ? "Saving..." : share ? "Save changes" : "Create link"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function FunderSharesDialog({ onClose }: { onClose: () => void }) {
  const { isAdmin } = useOrganization();
  const { toast } = useToast();
  const [shares, setShares] = useState<Share[] | null>(null);
  const [missing, setMissing] = useState(false);
  /** "new", the id of the link being edited, or null. */
  const [editing, setEditing] = useState<string | null>(null);

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

  const done = () => {
    setEditing(null);
    load();
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
          the link can view it unless you add a password, so send it only to the funder. Pause or delete it any time.
        </p>

        {missing ? (
          <p className="text-sm text-muted-foreground">
            Funder portals need a database update: run <code className="font-mono text-xs">010_people_outcomes_funder_portals.sql</code> in the
            Supabase SQL Editor.
          </p>
        ) : (
          <div className="space-y-4">
            {isAdmin &&
              (editing === "new" ? (
                <ShareForm onCancel={() => setEditing(null)} onSaved={done} />
              ) : (
                editing === null && (
                  <Button onClick={() => setEditing("new")}>
                    <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> New funder link
                  </Button>
                )
              ))}

            {shares === null ? (
              <p className="text-sm text-muted-foreground">Loading...</p>
            ) : shares.length === 0 ? (
              editing === null && <p className="text-sm text-muted-foreground">No funder links yet.{isAdmin ? "" : " Ask an owner or admin to create one."}</p>
            ) : (
              <ul className="space-y-3">
                {shares.map((s) => {
                  if (editing === s.id) {
                    return (
                      <li key={s.id}>
                        <ShareForm share={s} onCancel={() => setEditing(null)} onSaved={done} />
                      </li>
                    );
                  }
                  const paused = Boolean(s.revoked_at);
                  const expired = isExpired(s);
                  const filtersOn = filterCount(s.filters);
                  return (
                    <li key={s.id} className={`rounded-md border p-4 space-y-2 ${paused || expired ? "opacity-70" : ""}`}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium flex flex-wrap items-center gap-2">
                            {s.name}
                            {paused && <Badge variant="outline">Paused</Badge>}
                            {expired && <Badge variant="outline">Expired</Badge>}
                            {s.password_protected && (
                              <Badge variant="outline" className="gap-1">
                                <KeyRound className="h-3 w-3" aria-hidden="true" /> Password
                              </Badge>
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {periodText(s)} · {s.sections.map(sectionLabel).join(", ")}
                          </p>
                          {(filtersOn > 0 || s.expires_at) && (
                            <p className="text-xs text-muted-foreground">
                              {filtersOn > 0 && `${filtersOn} ${filtersOn === 1 ? "filter" : "filters"}`}
                              {filtersOn > 0 && s.expires_at && " · "}
                              {s.expires_at && `${expired ? "Expired" : "Expires"} ${new Date(s.expires_at).toLocaleDateString("en-US")}`}
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {s.view_count
                              ? `Viewed ${s.view_count} ${s.view_count === 1 ? "time" : "times"}, last ${new Date(s.last_viewed_at!).toLocaleDateString("en-US")}`
                              : "Not viewed yet"}
                          </p>
                        </div>
                        {isAdmin && editing === null && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setEditing(s.id)} aria-label={`Edit ${s.name}`}>
                              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Edit
                            </Button>
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
