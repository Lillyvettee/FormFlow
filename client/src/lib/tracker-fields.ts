/**
 * Customizable fields for the trackers (migration 011).
 *
 * Each organization can, per tracker:
 *   - rename built-in fields ("Campaign" -> "Fund")
 *   - hide built-in fields it doesn't use (not the ones reports depend on)
 *   - split the name into First name + Last name (donations, volunteer
 *     hours, people). The full name column is still saved as "First Last",
 *     so totals, reports and search work the same.
 *   - add its own fields, saved in each record's "custom" column
 *
 * Settings live in tracker_settings and are read with useTrackerFields().
 * The Customize fields window is components/customize-fields-dialog.tsx;
 * form inputs and display helpers are in components/custom-field-inputs.tsx.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

export type TrackerKind = "donations" | "volunteer_hours" | "inventory_items" | "links" | "people";

export type CustomFieldType = "text" | "textarea" | "number" | "date" | "select" | "checkbox" | "email" | "phone";

export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Yes / No" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

export interface CustomField {
  /** Stable key in each record's "custom" column. Never changes, even if the label does. */
  id: string;
  label: string;
  type: CustomFieldType;
  required?: boolean;
  /** Dropdown choices. */
  options?: string[];
}

export interface TrackerConfig {
  labels?: Record<string, string>;
  hidden?: string[];
  splitNames?: boolean;
  custom?: CustomField[];
}

export interface BuiltInField {
  key: string;
  label: string;
  /** False for fields that totals and reports depend on. */
  hideable: boolean;
}

/** Built-in fields, in the order they appear on each tracker's form. */
export const BUILT_IN_FIELDS: Record<TrackerKind, BuiltInField[]> = {
  donations: [
    { key: "donor_name", label: "Donor name", hideable: false },
    { key: "amount", label: "Amount", hideable: false },
    { key: "date", label: "Date", hideable: false },
    { key: "campaign", label: "Campaign", hideable: true },
    { key: "payment_method", label: "Payment method", hideable: true },
    { key: "notes", label: "Notes", hideable: true },
  ],
  volunteer_hours: [
    { key: "volunteer_name", label: "Volunteer name", hideable: false },
    { key: "hours", label: "Hours", hideable: false },
    { key: "date", label: "Date", hideable: false },
    { key: "activity", label: "Activity", hideable: true },
    { key: "notes", label: "Notes", hideable: true },
  ],
  inventory_items: [
    { key: "name", label: "Item name", hideable: false },
    { key: "quantity", label: "Quantity", hideable: false },
    { key: "unit", label: "Unit", hideable: true },
    { key: "category", label: "Category", hideable: true },
    { key: "condition", label: "Condition", hideable: true },
    { key: "location", label: "Location", hideable: true },
    { key: "low_stock_threshold", label: "Restock at", hideable: true },
    { key: "description", label: "Description", hideable: true },
    { key: "notes", label: "Notes", hideable: true },
  ],
  links: [
    { key: "title", label: "Title", hideable: false },
    { key: "url", label: "Web address", hideable: false },
    { key: "description", label: "Description", hideable: true },
    { key: "category", label: "Folder", hideable: true },
  ],
  people: [
    { key: "full_name", label: "Full name", hideable: false },
    { key: "email", label: "Email", hideable: true },
    { key: "phone", label: "Phone", hideable: true },
    { key: "program", label: "Program", hideable: true },
    { key: "status", label: "Status", hideable: false },
    { key: "start_date", label: "Start date", hideable: false },
    { key: "notes", label: "Notes", hideable: true },
  ],
};

export const TRACKER_NAMES: Record<TrackerKind, string> = {
  donations: "Donations",
  volunteer_hours: "Volunteer hours",
  inventory_items: "Inventory",
  links: "Links",
  people: "People",
};

/** The name field of trackers that can split names. */
export const NAME_FIELD: Partial<Record<TrackerKind, string>> = {
  donations: "donor_name",
  volunteer_hours: "volunteer_name",
  people: "full_name",
};

export const MAX_CUSTOM_FIELDS = 30;

/** "Jane" + "Smith" -> "Jane Smith" (blank parts dropped). */
export const joinName = (first: string, last: string): string => [first.trim(), last.trim()].filter(Boolean).join(" ");

/** Best guess at first and last name from a full name, for records saved before names were split. */
export const splitName = (full: string): { first: string; last: string } => {
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? "", last: parts.slice(1).join(" ") };
};

/** Random id for a new custom field. */
export const newFieldId = (): string => `f_${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;

/** Everything a tracker page needs to know about its fields. */
export interface TrackerFields {
  kind: TrackerKind;
  config: TrackerConfig;
  isLoading: boolean;
  /** False until migration 011 has been run; the page then works as before. */
  isAvailable: boolean;
  /** The label to show for a built-in field (renamed or default). */
  label: (key: string) => string;
  /** Whether a built-in field is shown. */
  shows: (key: string) => boolean;
  splitNames: boolean;
  custom: CustomField[];
  /** Reload after the Customize fields window saves. */
  reload: () => Promise<void>;
}

/** Load (and keep) one tracker's field settings for the signed-in member's organization. */
export function useTrackerFields(kind: TrackerKind): TrackerFields {
  const [config, setConfig] = useState<TrackerConfig>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(true);

  const reload = useCallback(async () => {
    const { data, error } = await supabase.from("tracker_settings").select("config").eq("tracker", kind).maybeSingle();
    if (error) {
      // Table missing (migration 011 not run yet): behave exactly as before.
      setIsAvailable(false);
      setConfig({});
    } else {
      setIsAvailable(true);
      setConfig((data?.config as TrackerConfig) ?? {});
    }
    setIsLoading(false);
  }, [kind]);

  useEffect(() => {
    reload();
  }, [reload]);

  return useMemo(() => {
    const builtIns = BUILT_IN_FIELDS[kind];
    const byKey = new Map(builtIns.map((f) => [f.key, f]));
    const hidden = new Set((config.hidden ?? []).filter((k) => byKey.get(k)?.hideable));
    return {
      kind,
      config,
      isLoading,
      isAvailable,
      label: (key: string) => config.labels?.[key]?.trim() || byKey.get(key)?.label || key,
      shows: (key: string) => !hidden.has(key),
      splitNames: Boolean(config.splitNames && NAME_FIELD[kind]),
      custom: (config.custom ?? []).filter((f) => f && f.id && f.label),
      reload,
    };
  }, [kind, config, isLoading, isAvailable, reload]);
}

/** Save a tracker's settings (owners and admins only; the database enforces it). */
export async function saveTrackerConfig(kind: TrackerKind, config: TrackerConfig): Promise<void> {
  const { error } = await supabase.from("tracker_settings").upsert({ tracker: kind, config }, { onConflict: "organization_id,tracker" });
  if (error) throw error;
}

// ===========================================================================
// Values
// ===========================================================================

export type CustomValues = Record<string, unknown>;

/** A record's custom values (the column can be missing on old rows). */
export const customOf = (record: { custom?: unknown } | null | undefined): CustomValues =>
  record?.custom && typeof record.custom === "object" ? (record.custom as CustomValues) : {};

/** Display text for a custom value. */
export const formatCustomValue = (field: CustomField, value: unknown): string => {
  if (value === undefined || value === null || value === "") return "";
  if (field.type === "checkbox") return value === true ? "Yes" : value === false ? "No" : String(value);
  if (field.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  if (field.type === "number" && typeof value === "number") return value.toLocaleString("en-US");
  return String(value);
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Check and clean custom values before saving. Returns the values to save
 * (only current fields, trimmed, numbers as numbers) and a message per
 * field id that has a problem.
 */
export function prepareCustomValues(fields: CustomField[], values: CustomValues): { values: CustomValues; errors: Record<string, string> } {
  // Values of fields that were deleted since are kept, so editing a record never loses data.
  const ids = new Set(fields.map((f) => f.id));
  const out: CustomValues = Object.fromEntries(Object.entries(values).filter(([k]) => !ids.has(k)));
  const errors: Record<string, string> = {};
  for (const f of fields) {
    let v = values[f.id];
    if (typeof v === "string") v = v.trim();
    const blank = v === undefined || v === null || v === "" || (f.type === "checkbox" && v !== true && f.required);
    if (blank) {
      if (f.required) errors[f.id] = f.type === "checkbox" ? `Check "${f.label}" to continue.` : `${f.label} is required.`;
      continue;
    }
    switch (f.type) {
      case "number": {
        const n = Number(v);
        if (!Number.isFinite(n)) errors[f.id] = `${f.label} must be a number.`;
        else out[f.id] = n;
        break;
      }
      case "email":
        if (!EMAIL.test(String(v))) errors[f.id] = `${f.label} must be an email address.`;
        else out[f.id] = v;
        break;
      case "date":
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) errors[f.id] = `${f.label} must be a date.`;
        else out[f.id] = v;
        break;
      case "checkbox":
        out[f.id] = v === true;
        break;
      case "select":
        if (!(f.options ?? []).includes(String(v))) errors[f.id] = `Choose one of the options for ${f.label}.`;
        else out[f.id] = v;
        break;
      default:
        out[f.id] = String(v).slice(0, f.type === "textarea" ? 5000 : 500);
    }
  }
  return { values: out, errors };
}
