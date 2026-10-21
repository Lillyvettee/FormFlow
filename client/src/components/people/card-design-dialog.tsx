/**
 * CardDesignDialog
 *
 * Owners and admins design the organization's ID card (migration 023), with
 * a live preview: title, layout, orientation, colors, which custom People
 * fields to show, and up to 3 lines of their own text. One design is used
 * for every card; print again after changing it.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { IdCardFace, type CardPerson } from "@/components/id-card-face";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { useTrackerFields } from "@/lib/tracker-fields";
import {
  CARD_LAYOUTS,
  CARD_ORIENTATIONS,
  MAX_CARD_FIELDS,
  MAX_CARD_LINE_LENGTH,
  MAX_CARD_LINES,
  defaultCardDesign,
  type CardDesign,
} from "@/lib/card-design";

function ColorInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border bg-transparent p-0.5"
        />
        <span className="font-mono text-xs text-muted-foreground">{value}</span>
      </div>
    </div>
  );
}

export function CardDesignDialog({
  initial,
  prefix,
  samplePerson,
  onSave,
  onClose,
}: {
  initial: CardDesign;
  prefix: string | null;
  /** Shown in the preview: a real person with a card, or a made-up one. */
  samplePerson: CardPerson | null;
  onSave: (design: CardDesign) => Promise<void>;
  onClose: () => void;
}) {
  const { organization, branding } = useOrganization();
  const { toast } = useToast();
  const fields = useTrackerFields("people");
  const [design, setDesign] = useState<CardDesign>(initial);
  const [isSaving, setIsSaving] = useState(false);

  const set = (patch: Partial<CardDesign>) => setDesign((d) => ({ ...d, ...patch }));
  const setColor = (key: keyof CardDesign["colors"]) => (v: string) => setDesign((d) => ({ ...d, colors: { ...d.colors, [key]: v } }));
  const lines = [...design.lines, ...Array(MAX_CARD_LINES).fill("")].slice(0, MAX_CARD_LINES);

  const preview: CardPerson = samplePerson ?? {
    id: "00000000-0000-4000-8000-000000000000",
    full_name: "Alex Sample",
    card_number: 123,
    custom: {},
  };

  const save = async () => {
    setIsSaving(true);
    try {
      await onSave({ ...design, title: design.title.trim(), lines: design.lines.map((l) => l.trim()).filter(Boolean) });
      toast({ title: "Card design saved", description: "Print cards again to use the new design." });
      onClose();
    } catch (err) {
      toast({ title: "Couldn't save the design", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Card design</DialogTitle>
          <DialogDescription>Used for every ID card your organization prints.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr_auto]">
          {/* ----- Settings ----- */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="card-title">Card title (optional)</Label>
              <Input id="card-title" value={design.title} onChange={(e) => set({ title: e.target.value })} maxLength={40} placeholder="e.g. Member card, Client ID" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="card-layout">Layout</Label>
                <Select value={design.layout} onValueChange={(v) => set({ layout: v as CardDesign["layout"] })}>
                  <SelectTrigger id="card-layout">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CARD_LAYOUTS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="card-orientation">Orientation</Label>
                <Select value={design.orientation} onValueChange={(v) => set({ orientation: v as CardDesign["orientation"] })}>
                  <SelectTrigger id="card-orientation">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CARD_ORIENTATIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {design.orientation === "portrait" && design.layout !== "header_band" && (
              <p className="text-xs text-muted-foreground">Portrait cards put the QR code in the middle, so "left" and "right" look the same.</p>
            )}

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Colors</legend>
              <div className="flex flex-wrap gap-4">
                <ColorInput id="card-bg" label="Background" value={design.colors.background} onChange={setColor("background")} />
                <ColorInput id="card-text" label="Text" value={design.colors.text} onChange={setColor("text")} />
                <ColorInput id="card-accent" label="Accent" value={design.colors.accent} onChange={setColor("accent")} />
              </div>
              <button
                type="button"
                className="text-xs text-muted-foreground underline hover:text-foreground"
                onClick={() => set({ colors: defaultCardDesign(branding.primaryColor).colors })}
              >
                Reset to {branding.primaryColor ? "our branding color" : "default colors"}
              </button>
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Fields from People</legend>
              {fields.custom.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add your own fields with Customize fields on the People page, and they can be shown here.
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">Up to {MAX_CARD_FIELDS}. Empty values are left off each card.</p>
                  <div className="grid sm:grid-cols-2 gap-1.5">
                    {fields.custom.map((f) => {
                      const on = design.customFieldIds.includes(f.id);
                      const full = !on && design.customFieldIds.length >= MAX_CARD_FIELDS;
                      return (
                        <label key={f.id} className={`flex items-center gap-2 text-sm ${full ? "opacity-50" : ""}`}>
                          <Checkbox
                            checked={on}
                            disabled={full}
                            onCheckedChange={(c) =>
                              set({ customFieldIds: c ? [...design.customFieldIds, f.id] : design.customFieldIds.filter((x) => x !== f.id) })
                            }
                          />
                          {f.label}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
            </fieldset>

            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium">Your own text</legend>
              <p className="text-xs text-muted-foreground">Up to {MAX_CARD_LINES} short lines, e.g. a phone number or opening hours.</p>
              {lines.map((line, i) => (
                <Input
                  key={i}
                  value={line}
                  maxLength={MAX_CARD_LINE_LENGTH}
                  aria-label={`Line ${i + 1}`}
                  placeholder={i === 0 ? "e.g. Show this card when you visit." : i === 1 ? "e.g. (555) 123-4567" : ""}
                  onChange={(e) => {
                    const next = [...lines];
                    next[i] = e.target.value;
                    set({ lines: next });
                  }}
                />
              ))}
            </fieldset>
          </div>

          {/* ----- Preview ----- */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Preview</p>
            <div className="rounded-md bg-muted/50 p-4 flex justify-center">
              <IdCardFace
                design={design}
                person={preview}
                prefix={prefix}
                orgName={organization?.name ?? ""}
                logoUrl={branding.logoUrl}
                customFields={fields.custom}
              />
            </div>
            <p className="text-xs text-muted-foreground">Actual size on screen may differ slightly; printing at 100% gives a standard ID badge.</p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving}>
            {isSaving ? "Saving..." : "Save design"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
