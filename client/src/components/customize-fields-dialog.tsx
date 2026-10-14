/**
 * Customize fields: rename or hide a tracker's built-in fields, split names
 * into first and last, and add the organization's own fields
 * (lib/tracker-fields.ts). Owners and admins only.
 *
 * CustomizeFieldsButton opens it, and renders nothing for anyone else.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { friendlyWriteError } from "@/lib/db-errors";
import {
  BUILT_IN_FIELDS,
  CUSTOM_FIELD_TYPES,
  MAX_CUSTOM_FIELDS,
  NAME_FIELD,
  TRACKER_NAMES,
  newFieldId,
  saveTrackerConfig,
  type CustomField,
  type CustomFieldType,
  type TrackerConfig,
  type TrackerFields,
} from "@/lib/tracker-fields";
import { ArrowDown, ArrowUp, Plus, SlidersHorizontal, Trash2 } from "lucide-react";

/** Comma-separated dropdown options, kept as typed until the box loses focus. */
function OptionsBox({ options, onChange, id }: { options: string[]; onChange: (o: string[]) => void; id: string }) {
  const [text, setText] = useState(options.join(", "));
  const parse = (t: string) => Array.from(new Set(t.split(",").map((s) => s.trim()).filter(Boolean)));
  return (
    <Input
      id={id}
      value={text}
      placeholder="Small, Medium, Large"
      onChange={(e) => {
        setText(e.target.value);
        onChange(parse(e.target.value));
      }}
      onBlur={() => setText(parse(text).join(", "))}
    />
  );
}

function CustomizeFieldsDialog({ fields, onClose }: { fields: TrackerFields; onClose: () => void }) {
  const { toast } = useToast();
  const kind = fields.kind;
  const builtIns = BUILT_IN_FIELDS[kind];
  const canSplit = Boolean(NAME_FIELD[kind]);

  const [labels, setLabels] = useState<Record<string, string>>(fields.config.labels ?? {});
  const [hidden, setHidden] = useState<Set<string>>(new Set(fields.config.hidden ?? []));
  const [splitNames, setSplitNames] = useState(Boolean(fields.config.splitNames));
  const [custom, setCustom] = useState<CustomField[]>(fields.custom);
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const updateField = (i: number, patch: Partial<CustomField>) => setCustom((cur) => cur.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, dir: -1 | 1) =>
    setCustom((cur) => {
      const j = i + dir;
      if (j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const fieldError = (f: CustomField) =>
    !f.label.trim() ? "Give this field a name." : f.type === "select" && !(f.options ?? []).length ? "Add at least one option." : null;
  const hasErrors = custom.some((f) => fieldError(f));

  const save = async () => {
    setShowErrors(true);
    if (hasErrors || isSaving) return;
    setIsSaving(true);
    const config: TrackerConfig = {
      labels: Object.fromEntries(Object.entries(labels).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
      hidden: builtIns.filter((b) => b.hideable && hidden.has(b.key)).map((b) => b.key),
      splitNames: canSplit && splitNames,
      custom: custom.map((f) => ({
        id: f.id,
        label: f.label.trim(),
        type: f.type,
        required: Boolean(f.required),
        ...(f.type === "select" ? { options: f.options ?? [] } : {}),
      })),
    };
    try {
      await saveTrackerConfig(kind, config);
      // Turning split names on fills first and last names from existing full names.
      if (config.splitNames && !fields.config.splitNames) {
        const { data, error } = await supabase.rpc("apply_name_split", { p_tracker: kind });
        if (error) throw error;
        if (Number(data) > 0) toast({ title: "Names split", description: `${data} existing records now have a first and last name. You can correct any of them by editing the record.` });
      }
      await fields.reload();
      toast({ title: "Fields saved" });
      onClose();
    } catch (err) {
      toast({ title: "Couldn't save fields", description: friendlyWriteError(err as { message?: string; code?: string }), variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Customize fields: {TRACKER_NAMES[kind]}</DialogTitle>
          <DialogDescription>Changes apply to everyone on your team, on the form, the table, exports and imports.</DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* ----- Built-in fields ----- */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">Built-in fields</h3>
            <ul className="space-y-2">
              {builtIns.map((b) => {
                const isName = NAME_FIELD[kind] === b.key;
                return (
                  <li key={b.key} className="grid grid-cols-[1fr_auto] items-center gap-3">
                    <div className="space-y-1">
                      <Input
                        value={labels[b.key] ?? ""}
                        onChange={(e) => setLabels((l) => ({ ...l, [b.key]: e.target.value }))}
                        placeholder={b.label}
                        maxLength={60}
                        aria-label={`Name for ${b.label}`}
                        disabled={isName && splitNames}
                      />
                      {isName && splitNames && <p className="text-xs text-muted-foreground">Shown as First name and Last name.</p>}
                    </div>
                    {b.hideable ? (
                      <label className="flex items-center gap-2 text-xs whitespace-nowrap">
                        <Switch
                          checked={!hidden.has(b.key)}
                          onCheckedChange={(on) =>
                            setHidden((h) => {
                              const next = new Set(h);
                              if (on) next.delete(b.key);
                              else next.add(b.key);
                              return next;
                            })
                          }
                          aria-label={`Show ${b.label}`}
                        />
                        {hidden.has(b.key) ? "Hidden" : "Shown"}
                      </label>
                    ) : (
                      <Badge variant="secondary" className="text-[10px] whitespace-nowrap" title="Totals and reports use this field">
                        Always shown
                      </Badge>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">Type a new name to rename a field; leave it blank to keep the default. Hiding a field keeps any values already saved.</p>
          </section>

          {/* ----- Split names ----- */}
          {canSplit && (
            <section className="flex items-start justify-between gap-4 rounded-md border p-4">
              <div className="space-y-1">
                <Label htmlFor="split-names" className="font-semibold">
                  First and last name
                </Label>
                <p className="text-xs text-muted-foreground">
                  Ask for first and last name separately instead of one name. Existing names are split automatically (first word
                  and the rest), and you can fix any by editing them.
                </p>
              </div>
              <Switch id="split-names" checked={splitNames} onCheckedChange={setSplitNames} />
            </section>
          )}

          {/* ----- Custom fields ----- */}
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">Your fields</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCustom((c) => [...c, { id: newFieldId(), label: "", type: "text", required: false }])}
                disabled={custom.length >= MAX_CUSTOM_FIELDS}
              >
                <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Add field
              </Button>
            </div>
            {custom.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No extra fields yet. Add one for anything else you track, like a T-shirt size, emergency contact or grant ID.
              </p>
            ) : (
              <ul className="space-y-3">
                {custom.map((f, i) => {
                  const error = showErrors ? fieldError(f) : null;
                  return (
                    <li key={f.id} className={`rounded-md border p-3 space-y-3 ${error ? "border-destructive" : ""}`}>
                      <div className="grid sm:grid-cols-[1fr_160px_auto] gap-2 items-start">
                        <Input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="Field name, e.g. Last name" maxLength={60} aria-label={`Name of field ${i + 1}`} />
                        <Select value={f.type} onValueChange={(v) => updateField(i, { type: v as CustomFieldType })}>
                          <SelectTrigger aria-label={`Type of field ${i + 1}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CUSTOM_FIELD_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value}>
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => move(i, 1)} disabled={i === custom.length - 1} aria-label="Move down">
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => {
                              if (fields.custom.some((x) => x.id === f.id) && !window.confirm(`Remove "${f.label || "this field"}"? Values already saved are kept but no longer shown.`)) return;
                              setCustom((c) => c.filter((_, j) => j !== i));
                            }}
                            aria-label={`Remove ${f.label || "field"}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                          </Button>
                        </div>
                      </div>
                      {f.type === "select" && (
                        <div className="space-y-1">
                          <Label htmlFor={`opts-${f.id}`} className="text-xs text-muted-foreground">
                            Options (comma-separated)
                          </Label>
                          <OptionsBox id={`opts-${f.id}`} options={f.options ?? []} onChange={(options) => updateField(i, { options })} />
                        </div>
                      )}
                      <label className="flex items-center gap-2 text-xs">
                        <Switch checked={Boolean(f.required)} onCheckedChange={(on) => updateField(i, { required: on })} />
                        Required
                      </label>
                      {error && <p className="text-xs text-destructive">{error}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save fields"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Customize fields" button for owners and admins; nothing for anyone else. */
export function CustomizeFieldsButton({ fields }: { fields: TrackerFields }) {
  const { isAdmin } = useOrganization();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  if (!isAdmin || fields.isLoading) return null;
  return (
    <>
      <Button
        variant="outline"
        onClick={() =>
          fields.isAvailable
            ? setOpen(true)
            : toast({
                title: "One more setup step",
                description: "Custom fields need a database update: run 011_custom_fields.sql in the Supabase SQL Editor, then refresh.",
              })
        }
      >
        <SlidersHorizontal className="mr-1 h-4 w-4" aria-hidden="true" /> Customize fields
      </Button>
      {open && <CustomizeFieldsDialog fields={fields} onClose={() => setOpen(false)} />}
    </>
  );
}
