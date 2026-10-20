/**
 * People (migration 010): the people an organization serves, and their
 * progress over time.
 *
 *   /people       everyone, with check-in counts; add people here
 *   /people/:id   one person: details, personal form links, help given,
 *                 case notes, progress on outcome questions, and every check-in
 *
 * Adding someone first checks for a possible duplicate (same name, email or
 * phone) and asks before creating a second record.
 *
 * Personal links: each person has a private token. Their link to a form is
 * the form's address plus ?p=<token> (lib/outcomes.ts), and responses sent
 * through it attach to their record. Resetting the token turns old links off.
 *
 * Who can see People is an organization setting (migration 015, chosen by
 * owners and admins at the top of the page): by default owners, admins and
 * members, not viewers. The database enforces it. Owners, admins and
 * members can add and change people when they can see them. Owners and admins can rename,
 * hide and add fields, and split names (Customize fields, migration 011).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { PlanLimitNotice } from "@/components/plan-limit-notice";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { friendlyWriteError } from "@/lib/db-errors";
import { fetchAll, formatDate, toISODate, answerFields } from "@/lib/report-utils";
import { newAccessToken, outcomeScore, personalFormLink } from "@/lib/outcomes";
import { ResponseDialog } from "@/components/reports/form-report";
import { PersonServices } from "@/components/people/person-services";
import { PersonCaseNotes } from "@/components/people/person-case-notes";
import { PersonHistory } from "@/components/people/person-history";
import { PEOPLE_ACCESS_OPTIONS, usePeopleAccess, type PeopleAccess } from "@/lib/people-access";
import { Lock } from "lucide-react";
import { CustomFieldInputs, SplitNameInputs } from "@/components/custom-field-inputs";
import { CustomizeFieldsButton } from "@/components/customize-fields-dialog";
import {
  customOf,
  formatCustomValue,
  joinName,
  prepareCustomValues,
  splitName,
  useTrackerFields,
  type CustomValues,
  type TrackerFields,
} from "@/lib/tracker-fields";
import { TimeSeriesChart } from "@/components/reports/report-ui";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowUpRight,
  Check,
  Copy,
  ExternalLink,
  Link2,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  UserRound,
  Users,
} from "lucide-react";
import type { Form, FormField, FormSubmission, Person } from "@/types/database";

const STATUS_LABELS: Record<Person["status"], string> = { active: "Active", completed: "Completed", inactive: "Inactive" };
const STATUS_VARIANTS: Record<Person["status"], "default" | "secondary" | "outline"> = { active: "default", completed: "secondary", inactive: "outline" };
const ALL = "__all__";

/** True when the error means migration 010 hasn't been run yet. */
const isMissingTable = (error: { code?: string } | null | undefined) => ["PGRST205", "42P01", "PGRST202"].includes(error?.code ?? "");

/** Shown instead of People to members whose role can't see it. */
function RestrictedNotice() {
  return (
    <Card className="p-6 max-w-xl space-y-2">
      <h2 className="font-semibold flex items-center gap-2">
        <Lock className="h-4 w-4 text-muted-foreground" aria-hidden="true" /> People is limited
      </h2>
      <p className="text-sm text-muted-foreground">
        Your organization limits who can see the people it serves, their help given and case notes. Ask an owner or admin if you need
        access.
      </p>
    </Card>
  );
}

/** Owners and admins choose who can see People. */
function PeopleAccessControl({ access, onChange }: { access: PeopleAccess; onChange: (next: PeopleAccess) => void }) {
  const { isAdmin } = useOrganization();
  if (!isAdmin) return null;
  return (
    <div className="flex items-center gap-2">
      <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <Select value={access} onValueChange={(v) => onChange(v as PeopleAccess)}>
        <SelectTrigger className="h-9 w-auto min-w-[15rem] text-sm" aria-label="Who can see People">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PEOPLE_ACCESS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              Visible to: {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SetupNotice() {
  return (
    <Card className="p-6 max-w-xl">
      <h2 className="font-semibold mb-1">One more setup step</h2>
      <p className="text-sm text-muted-foreground">
        People and outcome tracking need a database update: run <code className="font-mono text-xs">010_people_outcomes_funder_portals.sql</code> in
        the Supabase SQL Editor, then refresh this page.
      </p>
    </Card>
  );
}

// ===========================================================================
// Add / edit dialog
// ===========================================================================

/** A possible duplicate from find_similar_people (migration 012). */
interface SimilarPerson {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  program: string | null;
  matched_on: string;
}

interface Draft {
  full_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  program: string;
  status: Person["status"];
  start_date: string;
  notes: string;
}

function PersonDialog({
  person,
  programs,
  fields,
  onClose,
  onSaved,
}: {
  person: Person | "new";
  programs: string[];
  fields: TrackerFields;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<Draft>(() => {
    if (person === "new") {
      return { full_name: "", first_name: "", last_name: "", email: "", phone: "", program: "", status: "active", start_date: toISODate(new Date()), notes: "" };
    }
    // Records saved before names were split get a best guess.
    const guess = splitName(person.full_name);
    return {
      full_name: person.full_name,
      first_name: person.first_name ?? guess.first,
      last_name: person.last_name ?? guess.last,
      email: person.email ?? "",
      phone: person.phone ?? "",
      program: person.program ?? "",
      status: person.status,
      start_date: person.start_date,
      notes: person.notes ?? "",
    };
  });
  const [customValues, setCustomValues] = useState<CustomValues>(() => (person === "new" ? {} : customOf(person)));
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  /** Possible duplicates found when saving; the person decides before anything is created. */
  const [similar, setSimilar] = useState<SimilarPerson[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const set = (patch: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    if ("full_name" in patch || "first_name" in patch || "last_name" in patch || "email" in patch || "phone" in patch) setSimilar(null);
  };

  const fullName = fields.splitNames ? joinName(draft.first_name, draft.last_name) : draft.full_name.trim();
  const nameError = fullName ? null : fields.splitNames ? "Enter a first or last name." : "Enter a name.";
  const emailError =
    fields.shows("email") && draft.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim()) ? "Enter a valid email or leave it blank." : null;

  const save = async (skipDuplicateCheck = false) => {
    setShowErrors(true);
    const prepared = prepareCustomValues(fields.custom, customValues);
    setCustomErrors(prepared.errors);
    if (nameError || emailError || Object.keys(prepared.errors).length || isSaving) return;
    setIsSaving(true);

    // Ask before creating what may be a second record for the same person.
    // Also checked on edits that change the name, email or phone.
    const identityChanged =
      person === "new" ||
      fullName !== person.full_name ||
      (draft.email.trim() || null) !== person.email ||
      (draft.phone.trim() || null) !== person.phone;
    if (!skipDuplicateCheck && identityChanged) {
      const { data, error } = await supabase.rpc("find_similar_people", {
        p_name: fullName,
        p_email: fields.shows("email") ? draft.email.trim() || null : null,
        p_phone: fields.shows("phone") ? draft.phone.trim() || null : null,
        p_exclude: person === "new" ? null : person.id,
      });
      // If the check isn't available yet (migration 012), just save.
      if (!error && Array.isArray(data) && data.length) {
        setSimilar(data as SimilarPerson[]);
        setIsSaving(false);
        return;
      }
    }

    // Hidden fields are left out, so values saved before they were hidden are kept.
    const row: Record<string, unknown> = {
      full_name: fullName,
      status: draft.status,
      start_date: draft.start_date || toISODate(new Date()),
    };
    if (fields.shows("email")) row.email = draft.email.trim() || null;
    if (fields.shows("phone")) row.phone = draft.phone.trim() || null;
    if (fields.shows("program")) row.program = draft.program.trim() || null;
    if (fields.shows("notes")) row.notes = draft.notes.trim() || null;
    // Columns from migration 011 are only sent once it has been run.
    if (fields.isAvailable) {
      const parts = fields.splitNames ? { first: draft.first_name.trim(), last: draft.last_name.trim() } : splitName(fullName);
      row.first_name = parts.first || null;
      row.last_name = parts.last || null;
      row.custom = prepared.values;
    }

    const res =
      person === "new"
        ? await supabase.from("people").insert(row).select("id").single()
        : await supabase.from("people").update(row).eq("id", person.id).select("id").single();
    setIsSaving(false);
    if (res.error) {
      toast({ title: "Couldn't save", description: friendlyWriteError(res.error), variant: "destructive" });
      return;
    }
    toast({ title: person === "new" ? "Person added" : "Changes saved" });
    onSaved(res.data.id);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{person === "new" ? "Add a person" : "Edit details"}</DialogTitle>
          <DialogDescription>Someone your organization serves, so you can follow their progress over time.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {fields.splitNames ? (
            <SplitNameInputs
              first={draft.first_name}
              last={draft.last_name}
              onFirst={(v) => set({ first_name: v })}
              onLast={(v) => set({ last_name: v })}
              error={showErrors ? nameError : null}
              idPrefix="person-name"
              autoFocus
            />
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="person-name">{fields.label("full_name")}</Label>
              <Input id="person-name" value={draft.full_name} onChange={(e) => set({ full_name: e.target.value })} maxLength={150} autoFocus aria-invalid={showErrors && Boolean(nameError)} />
              {showErrors && nameError && <p className="text-xs text-destructive">{nameError}</p>}
            </div>
          )}
          {(fields.shows("email") || fields.shows("phone")) && (
            <div className="grid sm:grid-cols-2 gap-3">
              {fields.shows("email") && (
                <div className="space-y-1.5">
                  <Label htmlFor="person-email">{fields.label("email")} (optional)</Label>
                  <Input id="person-email" type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} aria-invalid={showErrors && Boolean(emailError)} />
                  {showErrors && emailError && <p className="text-xs text-destructive">{emailError}</p>}
                </div>
              )}
              {fields.shows("phone") && (
                <div className="space-y-1.5">
                  <Label htmlFor="person-phone">{fields.label("phone")} (optional)</Label>
                  <Input id="person-phone" type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} maxLength={40} />
                </div>
              )}
            </div>
          )}
          <div className="grid sm:grid-cols-2 gap-3">
            {fields.shows("program") && (
              <div className="space-y-1.5">
                <Label htmlFor="person-program">{fields.label("program")} (optional)</Label>
                <Input id="person-program" list="person-programs" value={draft.program} onChange={(e) => set({ program: e.target.value })} placeholder="e.g. Youth mentoring" maxLength={120} />
                <datalist id="person-programs">
                  {programs.map((p) => (
                    <option key={p} value={p} />
                  ))}
                </datalist>
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="person-start">{fields.label("start_date")}</Label>
              <Input id="person-start" type="date" value={draft.start_date} onChange={(e) => set({ start_date: e.target.value })} />
            </div>
          </div>
          {person !== "new" && (
            <div className="space-y-1.5">
              <Label htmlFor="person-status">{fields.label("status")}</Label>
              <Select value={draft.status} onValueChange={(v) => set({ status: v as Person["status"] })}>
                <SelectTrigger id="person-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(STATUS_LABELS) as Person["status"][]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <CustomFieldInputs fields={fields.custom} values={customValues} onChange={setCustomValues} errors={showErrors ? customErrors : {}} idPrefix="person-custom" />
          {fields.shows("notes") && (
            <div className="space-y-1.5">
              <Label htmlFor="person-notes">{fields.label("notes")} (optional)</Label>
              <Textarea id="person-notes" value={draft.notes} onChange={(e) => set({ notes: e.target.value })} maxLength={2000} rows={3} />
              <p className="text-xs text-muted-foreground">Visible to everyone on your team. Avoid medical or other sensitive details.</p>
            </div>
          )}
        </div>
        {similar && similar.length > 0 && (
          <div role="alert" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-4 space-y-3">
            <p className="text-sm font-medium">This may be someone who's already here:</p>
            <ul className="space-y-1.5 text-sm">
              {similar.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{m.full_name}</strong>
                    <span className="text-muted-foreground">
                      {[m.program, m.email, m.phone].filter(Boolean).length ? ` · ${[m.program, m.email, m.phone].filter(Boolean).join(" · ")}` : ""} (same {m.matched_on})
                    </span>
                  </span>
                  <Link href={`/people/${m.id}`} onClick={onClose} className="text-primary underline underline-offset-4 hover:no-underline">
                    Open existing
                  </Link>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {person === "new" ? "If this is a different person, choose Add anyway." : "If this is a different person, choose Save anyway."}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          {similar && similar.length > 0 ? (
            <Button onClick={() => save(true)} disabled={isSaving}>
              {isSaving ? "Saving..." : person === "new" ? "Add anyway" : "Save anyway"}
            </Button>
          ) : (
            <Button onClick={() => save()} disabled={isSaving}>
              {isSaving ? "Saving..." : person === "new" ? "Add person" : "Save"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ===========================================================================
// /people
// ===========================================================================

export default function PeoplePage() {
  const { canEdit } = useOrganization();
  const fields = useTrackerFields("people");
  const peopleAccess = usePeopleAccess();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [people, setPeople] = useState<Person[]>([]);
  const [checkins, setCheckins] = useState<Map<string, { count: number; last: string }>>(new Map());
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [program, setProgram] = useState<string>(ALL);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const [peopleRows, subs] = await Promise.all([
        fetchAll<Person>((f, t) => supabase.from("people").select("*").order("full_name").order("id").range(f, t)),
        fetchAll<{ person_id: string; submitted_at: string }>((f, t) =>
          supabase.from("form_submissions").select("person_id, submitted_at").not("person_id", "is", null).order("id").range(f, t),
        ),
      ]);
      const map = new Map<string, { count: number; last: string }>();
      for (const s of subs) {
        const row = map.get(s.person_id) ?? { count: 0, last: "" };
        row.count += 1;
        if (s.submitted_at > row.last) row.last = s.submitted_at;
        map.set(s.person_id, row);
      }
      setPeople(peopleRows);
      setCheckins(map);
      setState("ready");
    } catch (err) {
      // fetchAll throws plain Errors; the table-missing case mentions the table.
      const message = err instanceof Error ? err.message : "";
      if (/people|person_id|schema cache/i.test(message)) setState("missing");
      else {
        setState("ready");
        toast({ title: "Couldn't load people", description: message || "Refresh to try again.", variant: "destructive" });
      }
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const programs = useMemo(
    () => Array.from(new Set(people.map((p) => p.program?.trim()).filter((p): p is string => Boolean(p)))).sort(),
    [people],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter(
      (p) =>
        (status === ALL || p.status === status) &&
        (program === ALL || p.program?.trim() === program) &&
        (!q ||
          [p.full_name, p.email, p.phone, p.program].some((v) => v?.toLowerCase().includes(q)) ||
          fields.custom.some((f) => formatCustomValue(f, customOf(p)[f.id]).toLowerCase().includes(q))),
    );
  }, [people, search, status, program, fields.custom]);

  const totalCheckins = useMemo(() => [...checkins.values()].reduce((s, c) => s + c.count, 0), [checkins]);

  if (state === "loading") {
    return (
      <div className="p-6 space-y-4 max-w-6xl mx-auto" aria-busy="true">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">People</h1>
          <p className="text-muted-foreground">The people you serve, and how they're doing over time</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {peopleAccess.isAvailable && !peopleAccess.isLoading && (
            <PeopleAccessControl
              access={peopleAccess.access}
              onChange={async (next) => {
                try {
                  await peopleAccess.save(next);
                  toast({ title: "Saved", description: `People is now visible to: ${PEOPLE_ACCESS_OPTIONS.find((o) => o.value === next)?.label.toLowerCase()}.` });
                } catch (err) {
                  toast({ title: "Couldn't change who can see People", description: friendlyWriteError(err as { message?: string }), variant: "destructive" });
                }
              }}
            />
          )}
          {state === "ready" && <CustomizeFieldsButton fields={fields} />}
          {canEdit && state === "ready" && (
            <Button onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add person
            </Button>
          )}
        </div>
      </div>

      <ReadOnlyNotice />
      {state === "ready" && <PlanLimitNotice resource="people" used={people.length} />}

      {!peopleAccess.isLoading && !peopleAccess.canView ? (
        <RestrictedNotice />
      ) : state === "missing" ? (
        <SetupNotice />
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              ["Active", people.filter((p) => p.status === "active").length],
              ["Completed", people.filter((p) => p.status === "completed").length],
              ["Everyone", people.length],
              ["Check-ins", totalCheckins],
            ].map(([label, value]) => (
              <Card key={label} className="p-4">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-2xl font-bold">{Number(value).toLocaleString("en-US")}</p>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, email or program..." className="pl-8" aria-label="Search people" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40" aria-label="Filter by status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {(Object.keys(STATUS_LABELS) as Person["status"][]).map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {programs.length > 0 && fields.shows("program") && (
              <Select value={program} onValueChange={setProgram}>
                <SelectTrigger className="w-48" aria-label="Filter by program">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Any {fields.label("program").toLowerCase()}</SelectItem>
                  {programs.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {people.length === 0 ? (
            <Card className="p-10 text-center space-y-3">
              <Users className="h-8 w-8 text-muted-foreground mx-auto" aria-hidden="true" />
              <p className="font-medium">Track progress over time</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                Add the people you serve, then send each one their personal link to a check-in form. On forms, turn on
                "Track as an outcome" for questions like "How confident do you feel?" and Reports will show how people
                change from their first check-in to their latest.
              </p>
              {canEdit && (
                <Button onClick={() => setAdding(true)}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add your first person
                </Button>
              )}
            </Card>
          ) : shown.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-10">No one matches these filters.</p>
          ) : (
            <Card className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{fields.splitNames ? "Name" : fields.label("full_name")}</TableHead>
                    {fields.shows("program") && <TableHead>{fields.label("program")}</TableHead>}
                    <TableHead>{fields.label("status")}</TableHead>
                    <TableHead>{fields.label("start_date")}</TableHead>
                    {fields.custom.map((f) => (
                      <TableHead key={f.id}>{f.label}</TableHead>
                    ))}
                    <TableHead className="text-right">Check-ins</TableHead>
                    <TableHead>Last check-in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((p) => {
                    const c = checkins.get(p.id);
                    return (
                      <TableRow key={p.id} className="cursor-pointer" onClick={() => navigate(`/people/${p.id}`)}>
                        <TableCell className="font-medium">
                          <Link href={`/people/${p.id}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
                            {p.full_name}
                          </Link>
                        </TableCell>
                        {fields.shows("program") && <TableCell>{p.program ?? "-"}</TableCell>}
                        <TableCell>
                          <Badge variant={STATUS_VARIANTS[p.status]}>{STATUS_LABELS[p.status]}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{formatDate(p.start_date)}</TableCell>
                        {fields.custom.map((f) => (
                          <TableCell key={f.id} className="max-w-[180px] truncate">
                            {formatCustomValue(f, customOf(p)[f.id]) || "-"}
                          </TableCell>
                        ))}
                        <TableCell className="text-right">{c?.count ?? 0}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{c ? formatDate(toISODate(new Date(c.last))) : "-"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}

      {adding && <PersonDialog person="new" programs={programs} fields={fields} onClose={() => setAdding(false)} onSaved={(id) => navigate(`/people/${id}`)} />}
    </div>
  );
}

// ===========================================================================
// /people/:id
// ===========================================================================

function CopyLinkButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          toast({ title: "Couldn't copy automatically", description: text });
        }
      }}
    >
      {copied ? <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? "Copied" : "Copy link"}
    </Button>
  );
}

export function PersonPage() {
  const { id } = useParams<{ id: string }>();
  const { canEdit } = useOrganization();
  const fields = useTrackerFields("people");
  const peopleAccess = usePeopleAccess();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [person, setPerson] = useState<Person | null>(null);
  const [forms, setForms] = useState<Form[]>([]);
  const [subs, setSubs] = useState<FormSubmission[]>([]);
  const [programs, setPrograms] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "not_found">("loading");
  const [editing, setEditing] = useState(false);
  const [linkFormId, setLinkFormId] = useState("");
  const [viewing, setViewing] = useState<FormSubmission | null>(null);

  const load = useCallback(async () => {
    const [personRes, formsRes, subsRes, programsRes] = await Promise.all([
      supabase.from("people").select("*").eq("id", id).maybeSingle(),
      supabase.from("forms").select("*").eq("is_sample", false).order("title"),
      supabase.from("form_submissions").select("*").eq("person_id", id).order("submitted_at", { ascending: true }),
      supabase.from("people").select("program").not("program", "is", null),
    ]);
    if (isMissingTable(personRes.error)) {
      setState("missing");
      return;
    }
    if (personRes.error || !personRes.data) {
      setState("not_found");
      return;
    }
    setPerson(personRes.data);
    setForms(formsRes.data ?? []);
    setSubs(subsRes.data ?? []);
    setPrograms(Array.from(new Set((programsRes.data ?? []).map((r: { program: string }) => r.program.trim()))).sort());
    setState("ready");
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const formsById = useMemo(() => new Map(forms.map((f) => [f.id, f])), [forms]);
  const linkableForms = forms.filter((f) => f.is_published && !f.is_archived);
  // Forms with outcome questions first in the link picker.
  const sortedLinkable = useMemo(
    () =>
      [...linkableForms].sort(
        (a, b) =>
          Number(!answerFields(b.fields).some((f) => f.outcome)) - Number(!answerFields(a.fields).some((f) => f.outcome)) || a.title.localeCompare(b.title),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [forms],
  );
  useEffect(() => {
    if (!linkFormId && sortedLinkable[0]) setLinkFormId(sortedLinkable[0].id);
  }, [sortedLinkable, linkFormId]);

  /** Every outcome question this person has answered, with their scores over time. */
  const progress = useMemo(() => {
    const out: { key: string; form: Form; field: FormField; points: { date: string; score: number }[] }[] = [];
    for (const form of forms) {
      for (const field of answerFields(form.fields as FormField[]).filter((f) => f.outcome)) {
        const points = subs
          .filter((s) => s.form_id === form.id)
          .map((s) => ({ date: s.submitted_at, score: outcomeScore(field, (s.data as Record<string, unknown>)?.[field.id]) }))
          .filter((p): p is { date: string; score: number } => p.score != null);
        if (points.length) out.push({ key: `${form.id}:${field.id}`, form, field, points });
      }
    }
    return out;
  }, [forms, subs]);

  const resetLinks = async () => {
    if (!person) return;
    if (!window.confirm(`Turn off ${person.full_name}'s current links and make new ones? Links you've already sent will stop working.`)) return;
    const { data, error } = await supabase.from("people").update({ access_token: newAccessToken() }).eq("id", person.id).select("*").single();
    if (error) {
      toast({ title: "Couldn't reset links", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    setPerson(data);
    toast({ title: "New links ready", description: "Old links no longer work." });
  };

  const remove = async () => {
    if (!person) return;
    if (!window.confirm(`Delete ${person.full_name}? Their form responses stay, but are no longer connected to anyone.`)) return;
    const { error } = await supabase.from("people").delete().eq("id", person.id);
    if (error) {
      toast({ title: "Couldn't delete", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    toast({ title: "Deleted" });
    navigate("/people");
  };

  if (state === "loading") {
    return (
      <div className="p-6 space-y-4 max-w-5xl mx-auto" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (state === "missing") {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <SetupNotice />
      </div>
    );
  }
  if (!peopleAccess.isLoading && !peopleAccess.canView) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <RestrictedNotice />
      </div>
    );
  }
  if (state === "not_found" || !person) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-3">
        <p className="text-muted-foreground">This person couldn't be found. They may have been deleted.</p>
        <Button asChild variant="outline">
          <Link href="/people">Back to People</Link>
        </Button>
      </div>
    );
  }

  const link = linkFormId ? personalFormLink(linkFormId, person.access_token) : "";

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <Link href="/people" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> People
      </Link>

      {/* ----- Header ----- */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <UserRound className="h-6 w-6 text-primary" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-serif font-bold flex flex-wrap items-center gap-2">
              {person.full_name}
              <Badge variant={STATUS_VARIANTS[person.status]}>{STATUS_LABELS[person.status]}</Badge>
            </h1>
            <p className="text-sm text-muted-foreground">
              {[
                fields.shows("program") ? person.program : null,
                `${fields.label("start_date")}: ${formatDate(person.start_date)}`,
                fields.shows("email") ? person.email : null,
                fields.shows("phone") ? person.phone : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <CustomizeFieldsButton fields={fields} />
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Edit
            </Button>
            <Button variant="ghost" size="sm" onClick={remove} aria-label={`Delete ${person.full_name}`}>
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>

      {fields.custom.some((f) => formatCustomValue(f, customOf(person)[f.id])) && (
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-2">Details</p>
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {fields.custom
              .filter((f) => formatCustomValue(f, customOf(person)[f.id]))
              .map((f) => (
                <div key={f.id}>
                  <dt className="text-xs text-muted-foreground">{f.label}</dt>
                  <dd className="whitespace-pre-line break-words">{formatCustomValue(f, customOf(person)[f.id])}</dd>
                </div>
              ))}
          </dl>
        </Card>
      )}

      {person.notes && fields.shows("notes") && (
        <Card className="p-4">
          <p className="text-xs font-medium text-muted-foreground mb-1">{fields.label("notes")}</p>
          <p className="text-sm whitespace-pre-line">{person.notes}</p>
        </Card>
      )}

      {/* ----- Personal links ----- */}
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" aria-hidden="true" />
          <h2 className="font-semibold">Personal form link</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          Send {person.full_name.split(" ")[0]} this link by text or email. Their answers are added to this page automatically. You can also
          open it yourself to fill it in with them.
        </p>
        {sortedLinkable.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Publish a form first.{" "}
            <Link href="/forms" className="text-primary underline underline-offset-4">
              Go to Forms
            </Link>
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={linkFormId} onValueChange={setLinkFormId}>
                <SelectTrigger className="w-full sm:w-72" aria-label="Form for the personal link">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortedLinkable.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.title}
                      {answerFields(f.fields).some((x) => x.outcome) ? " (tracks outcomes)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <CopyLinkButton text={link} />
              <Button asChild variant="outline" size="sm">
                <a href={link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Fill in now
                </a>
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>Anyone with this link can send answers as {person.full_name.split(" ")[0]}, so share it only with them.</span>
              {canEdit && (
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={resetLinks}>
                  <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" /> Reset links
                </Button>
              )}
            </div>
          </>
        )}
      </Card>

      <PersonServices personId={person.id} personName={person.full_name} />

      <PersonCaseNotes personId={person.id} />

      <PersonHistory personId={person.id} />

      {/* ----- Progress ----- */}
      <div className="space-y-3">
        <h2 className="font-semibold">Progress</h2>
        {progress.length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">
            No outcome answers yet. When {person.full_name.split(" ")[0]} answers a question marked "Track as an outcome" through their link,
            their progress shows here.
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            {progress.map(({ key, form, field, points }) => {
              const first = points[0].score;
              const latest = points[points.length - 1].score;
              const better = field.outcome?.betterWhen === "lower" ? latest < first : latest > first;
              const worse = field.outcome?.betterWhen === "lower" ? latest > first : latest < first;
              const label = (n: number) => (field.type === "select" ? `${field.options?.[n - 1] ?? n}` : n.toLocaleString("en-US"));
              const Icon = better ? ArrowUpRight : worse ? ArrowDownRight : Minus;
              return (
                <Card key={key} className="p-5 space-y-3">
                  <div>
                    <p className="font-medium">{field.label}</p>
                    <p className="text-xs text-muted-foreground">{form.title}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span>
                      First: <strong>{label(first)}</strong>
                    </span>
                    <span>
                      Latest: <strong>{label(latest)}</strong>
                    </span>
                    {points.length > 1 && (
                      <span className={`flex items-center gap-1 ${better ? "text-emerald-600 dark:text-emerald-400" : worse ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {better ? "Improved" : worse ? "Declined" : "No change"}
                      </span>
                    )}
                  </div>
                  {points.length > 1 ? (
                    <TimeSeriesChart
                      kind="line"
                      seriesName={field.label}
                      heightClass="h-32"
                      data={points.map((p, i) => ({
                        key: `${i}`,
                        label: new Date(p.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
                        value: p.score,
                      }))}
                      valueFormatter={(n) => label(n)}
                    />
                  ) : (
                    <p className="text-xs text-muted-foreground">One check-in so far. Progress appears after the next one.</p>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* ----- Check-ins ----- */}
      <div className="space-y-3">
        <h2 className="font-semibold">Check-ins ({subs.length})</h2>
        {subs.length === 0 ? (
          <Card className="p-5 text-sm text-muted-foreground">No responses yet.</Card>
        ) : (
          <Card className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Form</TableHead>
                  <TableHead>
                    <span className="sr-only">View</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...subs].reverse().map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="whitespace-nowrap">{new Date(s.submitted_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</TableCell>
                    <TableCell>{formsById.get(s.form_id)?.title ?? "Deleted form"}</TableCell>
                    <TableCell className="text-right">
                      {formsById.get(s.form_id) && (
                        <Button size="sm" variant="ghost" onClick={() => setViewing(s)}>
                          View
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {editing && <PersonDialog person={person} programs={programs} fields={fields} onClose={() => setEditing(false)} onSaved={() => load()} />}
      {viewing && formsById.get(viewing.form_id) && (
        <ResponseDialog
          fields={answerFields(formsById.get(viewing.form_id)!.fields as FormField[])}
          sub={viewing}
          title={formsById.get(viewing.form_id)!.title}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
