/**
 * Fundraising goals (migration 009): a target amount over a date range, for
 * all donations or one campaign, with a progress bar.
 *
 * Goals have their own dates, so they don't follow the report period.
 * Owners, admins and members can add, edit and delete them; viewers see
 * progress only. Sample donations never count toward a goal.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { friendlyWriteError } from "@/lib/db-errors";
import { formatCurrency, formatDate, toISODate, daysInRange } from "@/lib/report-utils";
import { ChartCard, ProgressBar } from "@/components/reports/report-ui";
import { Pencil, Plus, Target, Trash2 } from "lucide-react";

export interface Goal {
  id: string;
  name: string;
  target_amount: number;
  campaign: string | null;
  start_date: string;
  end_date: string;
  raised: number;
  gift_count: number;
}

type GoalsState =
  | { status: "loading"; goals: Goal[] }
  | { status: "ready"; goals: Goal[] }
  /** Migration 009 hasn't been run yet. */
  | { status: "missing"; goals: Goal[] }
  | { status: "error"; goals: Goal[] };

/** Goals with their progress, newest end date first. */
export function useGoals() {
  const [state, setState] = useState<GoalsState>({ status: "loading", goals: [] });

  const load = useCallback(async () => {
    const [goalsRes, progressRes] = await Promise.all([
      supabase.from("fundraising_goals").select("*").order("end_date", { ascending: false }),
      supabase.rpc("get_goal_progress"),
    ]);
    const error = goalsRes.error ?? progressRes.error;
    if (error) {
      const missing = ["PGRST205", "PGRST202", "42P01", "42883"].includes(error.code ?? "");
      setState({ status: missing ? "missing" : "error", goals: [] });
      return;
    }
    const progress = new Map(
      ((progressRes.data ?? []) as { goal_id: string; raised: number | string; gift_count: number | string }[]).map((p) => [
        p.goal_id,
        p,
      ]),
    );
    setState({
      status: "ready",
      goals: (goalsRes.data ?? []).map((g) => ({
        ...g,
        target_amount: Number(g.target_amount),
        raised: Number(progress.get(g.id)?.raised ?? 0),
        gift_count: Number(progress.get(g.id)?.gift_count ?? 0),
      })),
    });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { ...state, reload: load };
}

/** "12 days left" / "Ends today" / "Ended Oct 1, 2026" / "Starts Nov 1, 2026" */
export const goalTiming = (g: Pick<Goal, "start_date" | "end_date">): string => {
  const today = toISODate(new Date());
  if (today < g.start_date) return `Starts ${formatDate(g.start_date)}`;
  if (today > g.end_date) return `Ended ${formatDate(g.end_date)}`;
  const left = daysInRange(today, g.end_date) - 1;
  return left === 0 ? "Ends today" : `${left} ${left === 1 ? "day" : "days"} left`;
};

// ===========================================================================
// Add / edit dialog
// ===========================================================================

interface Draft {
  name: string;
  target: string;
  campaign: string;
  start: string;
  end: string;
}

const yearRange = () => {
  const y = new Date().getFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
};

function GoalDialog({
  goal,
  campaigns,
  onClose,
  onSaved,
}: {
  goal: Goal | "new";
  campaigns: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() =>
    goal === "new"
      ? { name: "", target: "", campaign: "", ...yearRange() }
      : {
          name: goal.name,
          target: String(goal.target_amount),
          campaign: goal.campaign ?? "",
          start: goal.start_date,
          end: goal.end_date,
        },
  );
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const target = Number(draft.target);
  const errors = {
    name: draft.name.trim() ? null : "Give the goal a name.",
    target: Number.isFinite(target) && target > 0 ? null : "Enter an amount above $0.",
    dates: !draft.start || !draft.end ? "Choose start and end dates." : draft.end < draft.start ? "The end date is before the start date." : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const save = async () => {
    setShowErrors(true);
    if (hasErrors || isSaving) return;
    setIsSaving(true);
    const row = {
      name: draft.name.trim(),
      target_amount: Math.round(target * 100) / 100,
      campaign: draft.campaign.trim() || null,
      start_date: draft.start,
      end_date: draft.end,
    };
    const { error } =
      goal === "new"
        ? await supabase.from("fundraising_goals").insert(row)
        : await supabase.from("fundraising_goals").update(row).eq("id", goal.id);
    setIsSaving(false);
    if (error) {
      toast({ title: "Couldn't save the goal", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    toast({ title: goal === "new" ? "Goal added" : "Goal updated" });
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{goal === "new" ? "Add a fundraising goal" : "Edit goal"}</DialogTitle>
          <DialogDescription>Progress counts donations dated between the start and end dates.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="goal-name">Name</Label>
            <Input
              id="goal-name"
              value={draft.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="e.g. 2026 Annual Fund"
              maxLength={120}
              aria-invalid={showErrors && Boolean(errors.name)}
            />
            {showErrors && errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-target">Target amount ($)</Label>
            <Input
              id="goal-target"
              type="number"
              inputMode="decimal"
              min={1}
              step="0.01"
              value={draft.target}
              onChange={(e) => set({ target: e.target.value })}
              placeholder="10000"
              aria-invalid={showErrors && Boolean(errors.target)}
            />
            {showErrors && errors.target && <p className="text-xs text-destructive">{errors.target}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="goal-campaign">Campaign (optional)</Label>
            <Input
              id="goal-campaign"
              list="goal-campaigns"
              value={draft.campaign}
              onChange={(e) => set({ campaign: e.target.value })}
              placeholder="Leave blank to count all donations"
              maxLength={120}
            />
            <datalist id="goal-campaigns">
              {campaigns.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <p className="text-xs text-muted-foreground">Only donations recorded with this campaign will count.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="goal-start">Start date</Label>
              <Input id="goal-start" type="date" value={draft.start} onChange={(e) => set({ start: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="goal-end">End date</Label>
              <Input id="goal-end" type="date" value={draft.end} min={draft.start || undefined} onChange={(e) => set({ end: e.target.value })} />
            </div>
          </div>
          {showErrors && errors.dates && <p className="text-xs text-destructive">{errors.dates}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving}>
            {isSaving ? "Saving..." : goal === "new" ? "Add goal" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// Card
// ===========================================================================

export function GoalsCard({
  goals,
  campaigns,
  onChanged,
  limit,
}: {
  goals: ReturnType<typeof useGoals>;
  /** Campaign names from donations, suggested when adding a goal. */
  campaigns: string[];
  onChanged: () => void;
  /** Show only this many (current goals first), e.g. on the overview. */
  limit?: number;
}) {
  const { canEdit } = useOrganization();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Goal | "new" | null>(null);

  if (goals.status === "loading") return null;
  if (goals.status === "missing") {
    return (
      <ChartCard title="Fundraising goals" pdf={false}>
        <p className="text-sm text-muted-foreground">
          Goals need a one-time database update: run <code className="font-mono text-xs">009_fundraising_goals.sql</code> in
          the Supabase SQL Editor.
        </p>
      </ChartCard>
    );
  }

  const today = toISODate(new Date());
  // Current goals first, then upcoming, then ended.
  const rank = (g: Goal) => (today > g.end_date ? 2 : today < g.start_date ? 1 : 0);
  const sorted = [...goals.goals].sort((a, b) => rank(a) - rank(b) || a.end_date.localeCompare(b.end_date));
  const shown = limit ? sorted.filter((g) => rank(g) < 2).slice(0, limit) : sorted;
  if (limit && shown.length === 0) return null;

  const remove = async (g: Goal) => {
    if (!window.confirm(`Delete the goal "${g.name}"? Donations aren't affected.`)) return;
    const { error } = await supabase.from("fundraising_goals").delete().eq("id", g.id);
    if (error) {
      toast({ title: "Couldn't delete the goal", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    onChanged();
  };

  return (
    <ChartCard
      title="Fundraising goals"
      description={limit ? undefined : "Goals use their own dates, not the report period."}
      pdf={false}
      action={
        canEdit && !limit ? (
          <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Add goal
          </Button>
        ) : undefined
      }
    >
      {goals.status === "error" ? (
        <p className="text-sm text-muted-foreground">Goals couldn't be loaded. Refresh to try again.</p>
      ) : shown.length === 0 ? (
        <div className="text-center py-6 space-y-2">
          <Target className="h-6 w-6 text-muted-foreground mx-auto" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            No goals yet. {canEdit ? "Add one to track progress toward a campaign or yearly target." : ""}
          </p>
        </div>
      ) : (
        <ul className="space-y-5">
          {shown.map((g) => {
            const pct = Math.round((g.raised / g.target_amount) * 100);
            const ended = today > g.end_date;
            return (
              <li key={g.id} className="space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium flex flex-wrap items-center gap-2">
                      {g.name}
                      {g.campaign && <Badge variant="secondary">{g.campaign}</Badge>}
                      {pct >= 100 && <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white">Reached</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(g.start_date)} to {formatDate(g.end_date)} · {goalTiming(g)}
                    </p>
                  </div>
                  {canEdit && !limit && (
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(g)} aria-label={`Edit ${g.name}`}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(g)} aria-label={`Delete ${g.name}`}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </div>
                <ProgressBar value={g.raised} max={g.target_amount} color={ended && pct < 100 ? "hsl(220, 9%, 55%)" : undefined} />
                <p className="text-sm">
                  <span className="font-semibold">{formatCurrency(g.raised)}</span>{" "}
                  <span className="text-muted-foreground">
                    of {formatCurrency(g.target_amount)} ({pct}%) from {g.gift_count} {g.gift_count === 1 ? "gift" : "gifts"}
                  </span>
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {editing && <GoalDialog goal={editing} campaigns={campaigns} onClose={() => setEditing(null)} onSaved={onChanged} />}
    </ChartCard>
  );
}
