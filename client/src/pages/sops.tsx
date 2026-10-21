/**
 * SopsPage
 *
 * Route: /sops. Operations section, Mission and Enterprise (migration 025).
 * Standard operating procedures: step-by-step instructions grouped by
 * category. Everyone can read and print them; owners, admins and members
 * can write and edit. Every change keeps the previous version (sop_versions),
 * shown under "Version history".
 *
 * Write each step on its own line; lines starting with a number ("1.") or a
 * dash show as a list.
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
import { escapeHtml } from "@/lib/report-utils";
import { openPrintableReport } from "@/lib/report-pdf";
import { SOP_CATEGORIES } from "@/lib/grants";
import { ArrowLeft, BookOpen, History, Pencil, Plus, Printer, Search, Trash2 } from "lucide-react";

interface Sop {
  id: string;
  title: string;
  category: string;
  body: string;
  version: number;
  updated_by_name: string | null;
  updated_at: string;
}

interface SopVersion {
  id: number;
  version: number;
  title: string;
  category: string;
  body: string;
  edited_by_name: string | null;
  edited_at: string;
}

const ALL = "__all__";
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

/** Shows an SOP's text, turning numbered and dashed lines into lists. */
function SopBody({ body }: { body: string }) {
  const blocks: { kind: "ol" | "ul" | "p"; lines: string[] }[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    const kind = /^\s*\d+[.)]\s+/.test(line) ? "ol" : /^\s*[-*•]\s+/.test(line) ? "ul" : "p";
    const text = line.replace(/^\s*(\d+[.)]|[-*•])\s+/, "");
    const last = blocks[blocks.length - 1];
    if (!line.trim()) blocks.push({ kind: "p", lines: [] });
    else if (last && last.kind === kind && kind !== "p") last.lines.push(text);
    else if (last && last.kind === "p" && kind === "p" && last.lines.length) last.lines.push(text);
    else blocks.push({ kind, lines: [text] });
  }
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      {blocks
        .filter((b) => b.lines.length)
        .map((b, i) =>
          b.kind === "ol" ? (
            <ol key={i} className="list-decimal pl-6 space-y-1.5">
              {b.lines.map((l, j) => (
                <li key={j}>{l}</li>
              ))}
            </ol>
          ) : b.kind === "ul" ? (
            <ul key={i} className="list-disc pl-6 space-y-1">
              {b.lines.map((l, j) => (
                <li key={j}>{l}</li>
              ))}
            </ul>
          ) : (
            <p key={i} className="whitespace-pre-line">
              {b.lines.join("\n")}
            </p>
          ),
        )}
    </div>
  );
}

function SopDialog({ sop, categories, onClose, onSaved }: { sop: Sop | "new"; categories: string[]; onClose: () => void; onSaved: (id: string) => void }) {
  const { toast } = useToast();
  const isNew = sop === "new";
  const [title, setTitle] = useState(isNew ? "" : sop.title);
  const [category, setCategory] = useState(isNew ? "General" : sop.category);
  const [body, setBody] = useState(isNew ? "1. \n2. \n3. " : sop.body);
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    if (!title.trim() || isSaving) return;
    setIsSaving(true);
    const row = { title: title.trim(), category: category.trim() || "General", body };
    const res = isNew
      ? await supabase.from("sops").insert(row).select("id").single()
      : await supabase.from("sops").update(row).eq("id", sop.id).select("id").single();
    setIsSaving(false);
    if (res.error) {
      toast({ title: "Couldn't save", description: friendlyWriteError(res.error), variant: "destructive" });
      return;
    }
    toast({ title: isNew ? "Procedure added" : "Saved", description: isNew ? undefined : "The previous version is kept in the history." });
    onSaved(res.data.id);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? "New procedure" : "Edit procedure"}</DialogTitle>
          <DialogDescription>Write one step per line. Lines starting with "1." or "-" show as a list.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_14rem]">
            <div className="space-y-1.5">
              <Label htmlFor="sop-title">Title</Label>
              <Input id="sop-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={150} placeholder="e.g. Opening the pantry" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sop-category">Category</Label>
              <Input id="sop-category" value={category} onChange={(e) => setCategory(e.target.value)} maxLength={60} list="sop-categories" />
              <datalist id="sop-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sop-body">Steps</Label>
            <Textarea id="sop-body" value={body} onChange={(e) => setBody(e.target.value)} maxLength={50000} rows={16} className="font-mono text-sm" />
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

function HistoryDialog({ sop, onClose }: { sop: Sop; onClose: () => void }) {
  const [versions, setVersions] = useState<SopVersion[] | null>(null);
  const [viewing, setViewing] = useState<SopVersion | null>(null);
  useEffect(() => {
    supabase
      .from("sop_versions")
      .select("*")
      .eq("sop_id", sop.id)
      .order("version", { ascending: false })
      .then(({ data }) => setVersions((data as SopVersion[]) ?? []));
  }, [sop.id]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Version history: {sop.title}</DialogTitle>
          <DialogDescription>
            Current: version {sop.version}, {sop.updated_by_name ? `by ${sop.updated_by_name}, ` : ""}
            {fmtWhen(sop.updated_at)}.
          </DialogDescription>
        </DialogHeader>
        {viewing ? (
          <div className="space-y-3">
            <Button variant="ghost" size="sm" onClick={() => setViewing(null)}>
              <ArrowLeft className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> All versions
            </Button>
            <p className="text-sm text-muted-foreground">
              Version {viewing.version}: "{viewing.title}" ({viewing.category}){viewing.edited_by_name ? `, by ${viewing.edited_by_name}` : ""},{" "}
              {fmtWhen(viewing.edited_at)}
            </p>
            <Card className="p-4">
              <SopBody body={viewing.body} />
            </Card>
          </div>
        ) : versions === null ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No earlier versions. Each time this procedure is changed, the old version is kept here.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <span>
                  <strong>Version {v.version}</strong>
                  <span className="text-muted-foreground">
                    {" "}
                    · {v.edited_by_name ?? "Unknown"} · {fmtWhen(v.edited_at)}
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => setViewing(v)}>
                  View
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function SopsPage() {
  const { plan, canEdit, organization, branding } = useOrganization();
  const { toast } = useToast();
  const [sops, setSops] = useState<Sop[] | null>(null);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Sop | "new" | null>(null);
  const [history, setHistory] = useState<Sop | null>(null);
  const [category, setCategory] = useState(ALL);
  const [search, setSearch] = useState("");

  useEffect(() => {
    document.title = "SOPs - HumMotion";
  }, []);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase.from("sops").select("*").order("category").order("title");
    if (e) setError(e.message);
    setSops((data as Sop[]) ?? []);
  }, []);

  useEffect(() => {
    if (plan.features.operations) load();
  }, [plan.features.operations, load]);

  const categories = useMemo(
    () => Array.from(new Set([...SOP_CATEGORIES, ...(sops ?? []).map((s) => s.category)])).sort(),
    [sops],
  );
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (sops ?? []).filter((s) => (category === ALL || s.category === category) && (!q || s.title.toLowerCase().includes(q) || s.body.toLowerCase().includes(q)));
  }, [sops, category, search]);
  const grouped = useMemo(() => {
    const map = new Map<string, Sop[]>();
    for (const s of shown) map.set(s.category, [...(map.get(s.category) ?? []), s]);
    return [...map.entries()];
  }, [shown]);
  const selected = sops?.find((s) => s.id === selectedId) ?? null;

  const remove = async (s: Sop) => {
    if (!window.confirm(`Delete "${s.title}" and its version history?`)) return;
    const { error: e } = await supabase.from("sops").delete().eq("id", s.id);
    if (e) {
      toast({ title: "Couldn't delete", description: friendlyWriteError(e), variant: "destructive" });
      return;
    }
    setSelectedId(null);
    load();
  };

  /** Printing an SOP doesn't count toward the plan's PDF reports. */
  const print = async (s: Sop) => {
    const lines = s.body.split("\n");
    const html = `<div style="white-space: pre-line; line-height: 1.6; font-size: 14px">${lines.map((l) => escapeHtml(l)).join("\n")}</div>`;
    const opened = await openPrintableReport({
      title: s.title,
      periodLine: `${s.category} · Version ${s.version}${s.updated_by_name ? ` · Updated by ${s.updated_by_name}` : ""} · ${fmtWhen(s.updated_at)}`,
      orgName: organization?.name ?? "",
      logoUrl: branding.logoUrl,
      brandColor: branding.primaryColor,
      highlights: [],
      body: html,
    });
    if (!opened) toast({ title: "Pop-up blocked", description: "Allow pop-ups for this site to print.", variant: "destructive" });
  };

  if (!plan.features.operations) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card className="p-6 space-y-2">
          <h1 className="text-xl font-serif font-bold">SOPs</h1>
          <p className="text-sm text-muted-foreground">
            Write and share your standard operating procedures, with a full version history. Included with the Mission and Enterprise plans.{" "}
            <a href="/settings#plan" className="underline hover:text-foreground">
              See plans
            </a>
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">SOPs</h1>
          <p className="text-muted-foreground">Your standard operating procedures: how things are done here, step by step.</p>
        </div>
        {canEdit && (
          <Button onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> New procedure
          </Button>
        )}
      </div>

      {error && (
        <Card role="alert" className="p-4 text-sm text-destructive">
          {/relation .* does not exist|PGRST205/i.test(error) ? "SOPs need a database update: run 025_grants_and_sops.sql." : error}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        {/* ----- List ----- */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search procedures" aria-label="Search procedures" className="pl-8" />
          </div>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger aria-label="Category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sops === null ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground">{sops.length === 0 ? "No procedures yet." : "No procedures match."}</p>
          ) : (
            <nav aria-label="Procedures" className="space-y-4">
              {grouped.map(([cat, list]) => (
                <div key={cat}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{cat}</p>
                  <ul className="space-y-0.5">
                    {list.map((s) => (
                      <li key={s.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(s.id)}
                          aria-current={selectedId === s.id ? "true" : undefined}
                          className={`w-full rounded-md px-2 py-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            selectedId === s.id ? "bg-primary/10 text-primary font-medium" : "hover:bg-muted"
                          }`}
                        >
                          {s.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          )}
        </div>

        {/* ----- Reading pane ----- */}
        {selected ? (
          <Card className="p-6 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold">{selected.title}</h2>
                <p className="text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{selected.category}</Badge>
                  Version {selected.version}
                  {selected.updated_by_name ? ` · Updated by ${selected.updated_by_name}` : ""} · {fmtWhen(selected.updated_at)}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button size="sm" variant="ghost" onClick={() => print(selected)}>
                  <Printer className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Print
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setHistory(selected)}>
                  <History className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Version history
                </Button>
                {canEdit && (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setEditing(selected)}>
                      <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Edit
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => remove(selected)} aria-label={`Delete ${selected.title}`}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    </Button>
                  </>
                )}
              </div>
            </div>
            {selected.body.trim() ? <SopBody body={selected.body} /> : <p className="text-sm text-muted-foreground">No steps yet.</p>}
          </Card>
        ) : (
          <Card className="p-10 text-center space-y-2">
            <BookOpen className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {sops && sops.length > 0
                ? "Choose a procedure to read it."
                : canEdit
                  ? "Write down how things are done, like opening the pantry or the intake process, so anyone can follow the same steps."
                  : "No procedures have been written yet."}
            </p>
          </Card>
        )}
      </div>

      {editing && <SopDialog sop={editing} categories={categories} onClose={() => setEditing(null)} onSaved={(id) => { load(); setSelectedId(id); }} />}
      {history && <HistoryDialog sop={history} onClose={() => setHistory(null)} />}
    </div>
  );
}
