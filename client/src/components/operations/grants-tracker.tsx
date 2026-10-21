/**
 * GrantsTracker
 *
 * Grant readiness > Grants (migration 025): applications being tracked, and
 * a grant packet PDF for each: the grant's details, impact numbers for its
 * grant period (this year if none is set) and the narratives chosen for it.
 * Packets count toward the plan's monthly PDF reports, like other reports.
 */

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { friendlyWriteError } from "@/lib/db-errors";
import { escapeHtml, formatCurrency, formatDate, toISODate } from "@/lib/report-utils";
import { openPrintableReport, pdfHeading, pdfNote, pdfStats, pdfTable } from "@/lib/report-pdf";
import { GRANT_STATUSES, buildFigures, normalizeNumbers, type GrantNumbers, type GrantStatus } from "@/lib/grants";
import { useNarratives, type Narrative } from "@/components/operations/narratives";
import { savedVolunteerRate } from "@/components/operations/impact-numbers";
import { FileDown, Pencil, Plus, Trash2 } from "lucide-react";

export interface Grant {
  id: string;
  funder: string;
  name: string | null;
  amount_requested: number | string | null;
  amount_awarded: number | string | null;
  status: GrantStatus;
  deadline: string | null;
  report_due: string | null;
  period_start: string | null;
  period_end: string | null;
  contact: string | null;
  notes: string | null;
  narrative_ids: string[];
}

const statusLabel = (s: GrantStatus) => GRANT_STATUSES.find((x) => x.value === s)?.label ?? s;
const STATUS_TONE: Partial<Record<GrantStatus, string>> = {
  awarded: "border-emerald-600/40 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
  declined: "text-muted-foreground",
  closed: "text-muted-foreground",
};
const money = (v: number | string | null) => (v == null || v === "" ? null : Number(v));

/** Whole days from today to a date (negative = past). */
function daysUntil(iso: string): number {
  const today = new Date(toISODate(new Date()));
  return Math.round((new Date(iso).getTime() - today.getTime()) / 86_400_000);
}

/** "in 12 days", "today", "5 days ago". */
function relativeDays(iso: string): string {
  const days = daysUntil(iso);
  if (days === 0) return "today";
  return days > 0 ? `in ${days} ${days === 1 ? "day" : "days"}` : `${-days} ${days === -1 ? "day" : "days"} ago`;
}

function GrantDialog({ grant, narratives, onClose, onSaved }: { grant: Grant | "new"; narratives: Narrative[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const isNew = grant === "new";
  const g = isNew ? null : grant;
  const [funder, setFunder] = useState(g?.funder ?? "");
  const [name, setName] = useState(g?.name ?? "");
  const [requested, setRequested] = useState(g?.amount_requested != null ? String(g.amount_requested) : "");
  const [awarded, setAwarded] = useState(g?.amount_awarded != null ? String(g.amount_awarded) : "");
  const [status, setStatus] = useState<GrantStatus>(g?.status ?? "researching");
  const [deadline, setDeadline] = useState(g?.deadline ?? "");
  const [reportDue, setReportDue] = useState(g?.report_due ?? "");
  const [periodStart, setPeriodStart] = useState(g?.period_start ?? "");
  const [periodEnd, setPeriodEnd] = useState(g?.period_end ?? "");
  const [contact, setContact] = useState(g?.contact ?? "");
  const [notes, setNotes] = useState(g?.notes ?? "");
  const [narrativeIds, setNarrativeIds] = useState<string[]>(g?.narrative_ids ?? []);
  const [isSaving, setIsSaving] = useState(false);

  const amount = (v: string) => (v.trim() === "" ? null : Math.max(0, Number(v.replace(/[$,]/g, "")) || 0));
  const periodError = periodStart && periodEnd && periodEnd < periodStart ? "The end must be after the start." : null;

  const save = async () => {
    if (!funder.trim() || periodError || isSaving) return;
    setIsSaving(true);
    const row = {
      funder: funder.trim(),
      name: name.trim() || null,
      amount_requested: amount(requested),
      amount_awarded: amount(awarded),
      status,
      deadline: deadline || null,
      report_due: reportDue || null,
      period_start: periodStart || null,
      period_end: periodEnd || null,
      contact: contact.trim() || null,
      notes: notes.trim() || null,
      narrative_ids: narrativeIds,
    };
    const { error } = isNew ? await supabase.from("grants").insert(row) : await supabase.from("grants").update(row).eq("id", grant.id);
    setIsSaving(false);
    if (error) {
      toast({ title: "Couldn't save", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    toast({ title: isNew ? "Grant added" : "Saved" });
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "New grant" : "Edit grant"}</DialogTitle>
          <DialogDescription>Track the application, its dates, and what goes in its packet.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="grant-funder">Funder</Label>
              <Input id="grant-funder" value={funder} onChange={(e) => setFunder(e.target.value)} maxLength={150} placeholder="e.g. United Way" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-name">Grant or program (optional)</Label>
              <Input id="grant-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={150} placeholder="e.g. Community Impact Fund 2027" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-requested">Amount requested ($)</Label>
              <Input id="grant-requested" inputMode="decimal" value={requested} onChange={(e) => setRequested(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-awarded">Amount awarded ($)</Label>
              <Input id="grant-awarded" inputMode="decimal" value={awarded} onChange={(e) => setAwarded(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as GrantStatus)}>
                <SelectTrigger id="grant-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRANT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-deadline">Application deadline</Label>
              <Input id="grant-deadline" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-report">Report due</Label>
              <Input id="grant-report" type="date" value={reportDue} onChange={(e) => setReportDue(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-contact">Funder contact (optional)</Label>
              <Input id="grant-contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={300} placeholder="Name, email or phone" />
            </div>
          </div>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Grant period (for the packet's numbers)</legend>
            <div className="flex flex-wrap gap-2">
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} aria-label="Grant period start" className="w-44" />
              <Input type="date" value={periodEnd} min={periodStart} onChange={(e) => setPeriodEnd(e.target.value)} aria-label="Grant period end" className="w-44" />
            </div>
            <p className={`text-xs ${periodError ? "text-destructive" : "text-muted-foreground"}`}>
              {periodError ?? "Leave empty to use this year so far."}
            </p>
          </fieldset>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">Narratives in the packet</legend>
            {narratives.length === 0 ? (
              <p className="text-xs text-muted-foreground">Add narratives on the Narratives tab to include them here.</p>
            ) : (
              <div className="max-h-40 overflow-y-auto rounded-md border p-2 grid sm:grid-cols-2 gap-1.5">
                {narratives.map((n) => (
                  <label key={n.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={narrativeIds.includes(n.id)}
                      onCheckedChange={(on) => setNarrativeIds((ids) => (on ? [...ids, n.id] : ids.filter((x) => x !== n.id)))}
                    />
                    <span className="truncate" title={n.title}>
                      {n.title}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="grant-notes">Notes (optional)</Label>
            <Textarea id="grant-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!funder.trim() || Boolean(periodError) || isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function GrantsTracker() {
  const { canEdit, organization, branding } = useOrganization();
  const { toast } = useToast();
  const { narratives } = useNarratives();
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [editing, setEditing] = useState<Grant | "new" | null>(null);

  const load = async () => {
    const { data, error } = await supabase.from("grants").select("*").order("deadline", { ascending: true, nullsFirst: false });
    if (error) toast({ title: "Couldn't load grants", description: error.message, variant: "destructive" });
    setGrants((data as Grant[]) ?? []);
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    const list = grants ?? [];
    const open = list.filter((g) => ["researching", "writing", "submitted"].includes(g.status));
    return {
      pending: open.reduce((s, g) => s + (money(g.amount_requested) ?? 0), 0),
      awarded: list.reduce((s, g) => s + (money(g.amount_awarded) ?? 0), 0),
      open: open.length,
    };
  }, [grants]);

  const remove = async (g: Grant) => {
    if (!window.confirm(`Delete the grant from ${g.funder}?`)) return;
    const { error } = await supabase.from("grants").delete().eq("id", g.id);
    if (error) toast({ title: "Couldn't delete", description: friendlyWriteError(error), variant: "destructive" });
    else load();
  };

  /** Opens the packet: the tab opens on click, the numbers load, then it's written. */
  const downloadPacket = async (g: Grant) => {
    const year = new Date().getFullYear();
    const from = g.period_start ?? `${year}-01-01`;
    const to = g.period_end ?? toISODate(new Date());
    const periodText = `From ${formatDate(from)} to ${formatDate(to)}`;
    let numbers: GrantNumbers | null = null;
    try {
      const opened = await openPrintableReport({
        title: g.name ? `${g.funder}: ${g.name}` : g.funder,
        periodLine: `Grant packet · ${formatDate(from)} to ${formatDate(to)}`,
        orgName: organization?.name ?? "",
        logoUrl: branding.logoUrl,
        brandColor: branding.primaryColor,
        highlights: [],
        beforeWrite: async () => {
          const used = await supabase.rpc("use_report_export");
          if (used.error) throw new Error(used.error.message);
          const res = await supabase.rpc("get_grant_numbers", { p_from: from, p_to: to });
          if (res.error) throw new Error(res.error.message);
          numbers = normalizeNumbers(res.data as GrantNumbers);
        },
        body: () => {
          const figures = numbers ? buildFigures(numbers, periodText, savedVolunteerRate()) : [];
          const chosen = (narratives ?? []).filter((n) => g.narrative_ids.includes(n.id));
          const details: (string | number)[][] = [
            ["Funder", g.funder],
            ...(g.name ? [["Grant or program", g.name]] : []),
            ["Status", statusLabel(g.status)],
            ...(money(g.amount_requested) != null ? [["Amount requested", formatCurrency(money(g.amount_requested)!)]] : []),
            ...(money(g.amount_awarded) != null ? [["Amount awarded", formatCurrency(money(g.amount_awarded)!)]] : []),
            ...(g.deadline ? [["Application deadline", formatDate(g.deadline)]] : []),
            ...(g.report_due ? [["Report due", formatDate(g.report_due)]] : []),
          ];
          return (
            pdfHeading("Grant details") +
            pdfTable(["", ""], details) +
            pdfHeading("Impact") +
            (figures.length
              ? pdfStats(figures.slice(0, 4).map((f) => ({ label: f.label, value: f.value }))) +
                `<ul>${figures.map((f) => `<li>${escapeHtml(f.sentence)}</li>`).join("")}</ul>`
              : pdfNote("No records in this period.")) +
            chosen
              .map((n) => pdfHeading(n.title) + `<p style="white-space: pre-line; line-height: 1.55">${escapeHtml(n.body)}</p>`)
              .join("")
          );
        },
      });
      if (!opened) toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site to open the packet.", variant: "destructive" });
    } catch (err) {
      toast({ title: "Couldn't make the packet", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-6 text-sm">
          <span>
            <span className="text-muted-foreground">Open applications:</span> <strong>{totals.open}</strong>
          </span>
          <span>
            <span className="text-muted-foreground">Pending:</span> <strong>{formatCurrency(totals.pending)}</strong>
          </span>
          <span>
            <span className="text-muted-foreground">Awarded:</span> <strong>{formatCurrency(totals.awarded)}</strong>
          </span>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> New grant
          </Button>
        )}
      </div>

      <Card className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Funder</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Requested</TableHead>
              <TableHead className="text-right">Awarded</TableHead>
              <TableHead>Deadline</TableHead>
              <TableHead>Report due</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {grants === null ? (
              <TableRow>
                <TableCell colSpan={7} className="text-sm text-muted-foreground">
                  Loading...
                </TableCell>
              </TableRow>
            ) : grants.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-sm text-muted-foreground">
                  No grants yet. Add the ones you're applying for to keep deadlines and reports in one place.
                </TableCell>
              </TableRow>
            ) : (
              grants.map((g) => {
                const done = ["declined", "closed"].includes(g.status);
                // Highlight deadlines in the next two weeks for applications still in progress.
                const deadlineSoon = Boolean(g.deadline) && ["researching", "writing"].includes(g.status) && daysUntil(g.deadline!) >= 0 && daysUntil(g.deadline!) <= 14;
                return (
                  <TableRow key={g.id} className={done ? "opacity-70" : ""}>
                    <TableCell>
                      <span className="font-medium">{g.funder}</span>
                      {g.name && <span className="block text-xs text-muted-foreground">{g.name}</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_TONE[g.status] ?? ""}>
                        {statusLabel(g.status)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(g.amount_requested) != null ? formatCurrency(money(g.amount_requested)!) : "-"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(g.amount_awarded) != null ? formatCurrency(money(g.amount_awarded)!) : "-"}</TableCell>
                    <TableCell className="text-sm">
                      {g.deadline ? (
                        <>
                          {formatDate(g.deadline)}
                          <span className={`block text-xs ${deadlineSoon ? "text-amber-700 dark:text-amber-300 font-medium" : "text-muted-foreground"}`}>
                            {relativeDays(g.deadline)}
                          </span>
                        </>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {g.report_due ? (
                        <>
                          {formatDate(g.report_due)}
                          <span className="block text-xs text-muted-foreground">{relativeDays(g.report_due)}</span>
                        </>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => downloadPacket(g)}>
                        <FileDown className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Packet
                      </Button>
                      {canEdit && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(g)} aria-label={`Edit ${g.funder}`}>
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(g)} aria-label={`Delete ${g.funder}`}>
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
      <p className="text-xs text-muted-foreground">
        Packets include the grant's details, impact numbers for its grant period and the narratives you chose. Each counts as one PDF report.
      </p>

      {editing && <GrantDialog grant={editing} narratives={narratives ?? []} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
