/**
 * Inputs for an organization's own tracker fields and split first/last
 * names (lib/tracker-fields.ts), shared by every tracker's add/edit form.
 */

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CustomField, CustomValues } from "@/lib/tracker-fields";

const NONE = "__none__";

/** One input per custom field, two columns on wider screens. */
export function CustomFieldInputs({
  fields,
  values,
  onChange,
  errors = {},
  idPrefix = "custom",
}: {
  fields: CustomField[];
  values: CustomValues;
  onChange: (next: CustomValues) => void;
  errors?: Record<string, string>;
  idPrefix?: string;
}) {
  if (!fields.length) return null;
  const set = (id: string, v: unknown) => onChange({ ...values, [id]: v });

  return (
    <div className="grid sm:grid-cols-2 gap-4">
      {fields.map((f) => {
        const id = `${idPrefix}-${f.id}`;
        const value = values[f.id];
        const error = errors[f.id];
        const label = (
          <Label htmlFor={id}>
            {f.label}
            {f.required && <span className="text-destructive"> *</span>}
          </Label>
        );
        const common = { id, "aria-invalid": Boolean(error), "aria-describedby": error ? `${id}-error` : undefined };

        return (
          <div key={f.id} className={`space-y-1.5 ${f.type === "textarea" ? "sm:col-span-2" : ""}`}>
            {f.type === "checkbox" ? (
              <div className="flex items-center gap-2 pt-6">
                <Checkbox {...common} checked={value === true} onCheckedChange={(on) => set(f.id, on === true)} />
                {label}
              </div>
            ) : (
              <>
                {label}
                {f.type === "textarea" ? (
                  <Textarea {...common} value={typeof value === "string" ? value : ""} onChange={(e) => set(f.id, e.target.value)} maxLength={5000} rows={3} />
                ) : f.type === "select" ? (
                  <Select value={typeof value === "string" && value ? value : NONE} onValueChange={(v) => set(f.id, v === NONE ? "" : v)}>
                    <SelectTrigger {...common}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>{f.required ? "Choose..." : "None"}</SelectItem>
                      {(f.options ?? []).map((o) => (
                        <SelectItem key={o} value={o}>
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    {...common}
                    type={f.type === "number" ? "number" : f.type === "date" ? "date" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : "text"}
                    inputMode={f.type === "number" ? "decimal" : undefined}
                    value={value === undefined || value === null ? "" : String(value)}
                    onChange={(e) => set(f.id, e.target.value)}
                    maxLength={f.type === "number" || f.type === "date" ? undefined : 500}
                  />
                )}
              </>
            )}
            {error && (
              <p id={`${id}-error`} className="text-xs text-destructive">
                {error}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** First and last name boxes, used instead of one name box when names are split. */
export function SplitNameInputs({
  first,
  last,
  onFirst,
  onLast,
  error,
  idPrefix = "name",
  autoFocus,
}: {
  first: string;
  last: string;
  onFirst: (v: string) => void;
  onLast: (v: string) => void;
  /** Shown under the boxes, e.g. "Enter a first or last name." */
  error?: string | null;
  idPrefix?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-first`}>First name</Label>
          <Input id={`${idPrefix}-first`} value={first} onChange={(e) => onFirst(e.target.value)} maxLength={100} autoComplete="off" autoFocus={autoFocus} aria-invalid={Boolean(error)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-last`}>Last name</Label>
          <Input id={`${idPrefix}-last`} value={last} onChange={(e) => onLast(e.target.value)} maxLength={100} autoComplete="off" aria-invalid={Boolean(error)} />
        </div>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
