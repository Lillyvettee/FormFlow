/**
 * Narratives
 *
 * Grant readiness > Narratives (migration 025): saved answers to common
 * grant questions, with word and character counts and a copy button.
 * Everyone can read and copy; owners, admins and members can edit.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { friendlyWriteError } from "@/lib/db-errors";
import { NARRATIVE_CATEGORIES, textCounts } from "@/lib/grants";
import { CopyButton } from "@/components/operations/impact-numbers";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";

export interface Narrative {
  id: string;
  title: string;
  category: string;
  body: string;
  updated_at: string;
}

const ALL = "__all__";

function NarrativeDialog({ narrative, onClose, onSaved }: { narrative: Narrative | "new"; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const isNew = narrative === "new";
  const [title, setTitle] = useState(isNew ? "" : narrative.title);
  const [category, setCategory] = useState(isNew ? NARRATIVE_CATEGORIES[0] : narrative.category);
  const [body, setBody] = useState(isNew ? "" : narrative.body);
  const [isSaving, setIsSaving] = useState(false);
  const counts = textCounts(body);

  const save = async () => {
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    const row = { title: title.trim(), category, body };
    const { error } = isNew
      ? await supabase.from("grant_narratives").insert(row)
      : await supabase.from("grant_narratives").update(row).eq("id", narrative.id);
    setIsSaving(false);
    if (error) {
      toast({ title: "Couldn't save", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    toast({ title: isNew ? "Narrative added" : "Saved" });
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "New narrative" : "Edit narrative"}</DialogTitle>
          <DialogDescription>Write it once, reuse it in every application.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <div className="space-y-1.5">
              <Label htmlFor="narrative-title">Title</Label>
              <Input id="narrative-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder="e.g. Mission statement (short)" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="narrative-category">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="narrative-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {NARRATIVE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              <Label htmlFor="narrative-body">Text</Label>
              <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {counts.words.toLocaleString("en-US")} words · {counts.characters.toLocaleString("en-US")} characters
              </span>
            </div>
            <Textarea id="narrative-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={20000} rows={14} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!title.trim() || isSaving}>
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Loads the organization's narratives; shared by Narratives and the grant tracker. */
export function useNarratives() {
  const [narratives, setNarratives] = useState<Narrative[] | null>(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("grant_narratives").select("id, title, category, body, updated_at").order("category").order("title");
    setNarratives((data as Narrative[]) ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { narratives, reload: load };
}

export function Narratives() {
  const { canEdit } = useOrganization();
  const { toast } = useToast();
  const { narratives, reload } = useNarratives();
  const [editing, setEditing] = useState<Narrative | "new" | null>(null);
  const [category, setCategory] = useState(ALL);
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (narratives ?? []).filter(
      (n) => (category === ALL || n.category === category) && (!q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)),
    );
  }, [narratives, category, search]);

  const remove = async (n: Narrative) => {
    if (!window.confirm(`Delete "${n.title}"?`)) return;
    const { error } = await supabase.from("grant_narratives").delete().eq("id", n.id);
    if (error) toast({ title: "Couldn't delete", description: friendlyWriteError(error), variant: "destructive" });
    else reload();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search narratives" aria-label="Search narratives" className="pl-8" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-48" aria-label="Category">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {NARRATIVE_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canEdit && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> New narrative
          </Button>
        )}
      </div>

      {narratives === null ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : shown.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          {narratives.length === 0
            ? "No narratives yet. Start with your mission statement and need statement; most applications ask for both."
            : "No narratives match."}
        </Card>
      ) : (
        <ul className="space-y-3">
          {shown.map((n) => {
            const c = textCounts(n.body);
            return (
              <li key={n.id}>
                <Card className="p-4 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium flex flex-wrap items-center gap-2">
                        {n.title} <Badge variant="outline">{n.category}</Badge>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.words.toLocaleString("en-US")} words · {c.characters.toLocaleString("en-US")} characters
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <CopyButton text={n.body} />
                      {canEdit && (
                        <>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setEditing(n)}>
                            <Pencil className="mr-1 h-3 w-3" aria-hidden="true" /> Edit
                          </Button>
                          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(n)} aria-label={`Delete ${n.title}`}>
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <p className="text-sm whitespace-pre-line line-clamp-4">{n.body || <span className="text-muted-foreground">No text yet.</span>}</p>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {editing && <NarrativeDialog narrative={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}
