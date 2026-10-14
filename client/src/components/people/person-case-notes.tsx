/**
 * PersonCaseNotes
 *
 * Dated notes about a person, newest first, with who wrote each one
 * (migration 012). Anyone who can edit adds notes; authors can edit or
 * delete their own, and owners and admins can delete any. The database
 * fills in the author, so it can't be changed or faked.
 */

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { friendlyWriteError } from "@/lib/db-errors";
import { NotebookPen, Pencil, Trash2 } from "lucide-react";

interface CaseNote {
  id: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_at: string | null;
}

const MAX_LENGTH = 5000;
const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

export function PersonCaseNotes({ personId }: { personId: string }) {
  const { user } = useAuth();
  const { canEdit, isAdmin } = useOrganization();
  const { toast } = useToast();
  const [notes, setNotes] = useState<CaseNote[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [draft, setDraft] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("case_notes").select("*").eq("person_id", personId).order("created_at", { ascending: false });
    if (error) {
      setState(["PGRST205", "42P01"].includes(error.code ?? "") ? "missing" : "ready");
      return;
    }
    setNotes(data ?? []);
    setState("ready");
  }, [personId]);

  useEffect(() => {
    load();
  }, [load]);

  const add = async () => {
    if (!draft.trim() || isSaving) return;
    setIsSaving(true);
    const { error } = await supabase.from("case_notes").insert({ person_id: personId, body: draft.trim() });
    setIsSaving(false);
    if (error) {
      toast({ title: "Couldn't add the note", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    setDraft("");
    load();
  };

  const saveEdit = async (id: string) => {
    if (!editText.trim()) return;
    const { error } = await supabase.from("case_notes").update({ body: editText.trim() }).eq("id", id);
    if (error) {
      toast({ title: "Couldn't save the note", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    setEditingId(null);
    load();
  };

  const remove = async (n: CaseNote) => {
    if (!window.confirm("Delete this note? This can't be undone.")) return;
    const { error } = await supabase.from("case_notes").delete().eq("id", n.id);
    if (error) {
      toast({ title: "Couldn't delete the note", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    load();
  };

  if (state === "loading") return null;

  return (
    <div className="space-y-3">
      <h2 className="font-semibold flex items-center gap-2">
        <NotebookPen className="h-4 w-4 text-primary" aria-hidden="true" /> Case notes ({notes.length})
      </h2>
      {state === "missing" ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Case notes need a database update: run <code className="font-mono text-xs">012_services_and_case_notes.sql</code> in the Supabase SQL Editor.
        </Card>
      ) : (
        <>
          {canEdit && (
            <Card className="p-4 space-y-2">
              <label htmlFor="new-case-note" className="sr-only">
                New note
              </label>
              <Textarea
                id="new-case-note"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add a note, e.g. what was discussed or next steps..."
                maxLength={MAX_LENGTH}
                rows={3}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">Visible to your whole team. Avoid medical or other sensitive details.</p>
                <Button size="sm" onClick={add} disabled={!draft.trim() || isSaving}>
                  {isSaving ? "Adding..." : "Add note"}
                </Button>
              </div>
            </Card>
          )}
          {notes.length === 0 ? (
            <Card className="p-5 text-sm text-muted-foreground">No notes yet.</Card>
          ) : (
            <ul className="space-y-3">
              {notes.map((n) => {
                const mine = Boolean(user && n.author_id === user.id);
                return (
                  <li key={n.id}>
                    <Card className="p-4 space-y-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">{n.author_name || "Former team member"}</span> · {when(n.created_at)}
                          {n.updated_at && <span> · edited</span>}
                        </p>
                        {canEdit && (mine || isAdmin) && editingId !== n.id && (
                          <div className="flex gap-1">
                            {mine && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingId(n.id); setEditText(n.body); }} aria-label="Edit note">
                                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(n)} aria-label="Delete note">
                              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </div>
                      {editingId === n.id ? (
                        <div className="space-y-2">
                          <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} maxLength={MAX_LENGTH} rows={3} aria-label="Edit note" autoFocus />
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                              Cancel
                            </Button>
                            <Button size="sm" onClick={() => saveEdit(n.id)} disabled={!editText.trim()}>
                              Save
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-sm whitespace-pre-line break-words">{n.body}</p>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
