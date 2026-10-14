/**
 * FormTemplatePicker
 *
 * Opens when someone clicks "New form": start from a blank form, or from one
 * of the ready-made templates in lib/form-templates.ts. Either way the form
 * builder opens next, so everything can be changed before saving.
 */

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FORM_TEMPLATES, type FormTemplate } from "@/lib/form-templates";
import { Plus, FileText } from "lucide-react";

const CATEGORIES = ["All", ...Array.from(new Set(FORM_TEMPLATES.map((t) => t.category)))] as const;

const cardClass =
  "text-left rounded-md border p-4 hover:border-primary hover:bg-primary/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function FormTemplatePicker({
  open,
  onClose,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  /** null means "start from scratch". */
  onPick: (template: FormTemplate | null) => void;
}) {
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const shown = category === "All" ? FORM_TEMPLATES : FORM_TEMPLATES.filter((t) => t.category === category);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create a form</DialogTitle>
          <DialogDescription>
            Start with a ready-made form and change anything you like, or build your own from scratch.
          </DialogDescription>
        </DialogHeader>

        {/* Category filter */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter templates by category">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                category === c ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {/* Blank form, always first */}
          <button type="button" onClick={() => onPick(null)} className={`${cardClass} border-dashed`} data-testid="button-template-blank">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                <Plus className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <p className="font-medium">Start from scratch</p>
                <p className="text-sm text-muted-foreground">A blank form with your own questions.</p>
              </div>
            </div>
          </button>

          {shown.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t)}
              className={cardClass}
              data-testid={`button-template-${t.id}`}
            >
              <div className="flex items-start gap-3">
                <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                  <FileText className="h-4 w-4 text-primary" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{t.name}</p>
                    <Badge variant="secondary" className="text-[10px]">
                      {t.category}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{t.summary}</p>
                  <p className="text-xs text-muted-foreground truncate" title={t.fields.map((f) => f.label).join(", ")}>
                    {t.fields.length} questions: {t.fields.map((f) => f.label).join(", ")}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
