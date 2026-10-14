/**
 * Spreadsheet import for donations, volunteer hours, links and inventory.
 *
 *   readSpreadsheet  CSV or Excel (.xlsx) file -> header row + rows of text
 *   autoMatch        guesses which column holds which field, from the headers
 *   checkRows        turns rows into records, with a problem list per row and
 *                    duplicates flagged (against saved records and earlier
 *                    rows in the same file)
 *   IMPORTERS        what each record type needs: fields, how to read each
 *                    value, and what counts as a duplicate
 *   buildImporter    an importer adjusted to the organization's own field
 *                    setup: renamed and hidden fields, first/last names and
 *                    custom fields (lib/tracker-fields.ts)
 *
 * The libraries are loaded only when someone imports, so they don't slow
 * down the rest of the app. The Import window is components/import-dialog.tsx.
 */

import { supabase } from "@/lib/supabase";
import { fetchAll, toISODate } from "@/lib/report-utils";
import { joinName, NAME_FIELD, splitName, type CustomField, type TrackerFields } from "@/lib/tracker-fields";

export const MAX_IMPORT_ROWS = 5000;

// ===========================================================================
// Reading files
// ===========================================================================

export interface Sheet {
  headers: string[];
  rows: string[][];
}

/** A cell from Excel as text. Date cells become "YYYY-MM-DD". */
const cellText = (cell: unknown): string => {
  if (cell == null) return "";
  if (cell instanceof Date) {
    // Excel dates arrive as UTC midnight; read the UTC parts so the day doesn't shift.
    return `${cell.getUTCFullYear()}-${String(cell.getUTCMonth() + 1).padStart(2, "0")}-${String(cell.getUTCDate()).padStart(2, "0")}`;
  }
  return String(cell).trim();
};

/** Read a CSV or .xlsx file. Throws an Error with a readable message. */
export async function readSpreadsheet(file: File): Promise<Sheet> {
  const name = file.name.toLowerCase();
  let grid: string[][];

  if (name.endsWith(".csv") || name.endsWith(".txt") || file.type === "text/csv") {
    const Papa = (await import("papaparse")).default;
    grid = await new Promise<string[][]>((resolve, reject) =>
      Papa.parse<string[]>(file, {
        skipEmptyLines: "greedy",
        complete: (res) => resolve(res.data.map((r) => r.map((c) => String(c ?? "").trim()))),
        error: (err) => reject(new Error(`Couldn't read the CSV file: ${err.message}`)),
      }),
    );
  } else if (name.endsWith(".xlsx")) {
    const readXlsxFile = (await import("read-excel-file")).default;
    try {
      const rows = await readXlsxFile(file);
      grid = rows.map((r) => r.map(cellText)).filter((r) => r.some(Boolean));
    } catch {
      throw new Error("Couldn't read that Excel file. Try saving it again as .xlsx, or as CSV.");
    }
  } else if (name.endsWith(".xls")) {
    throw new Error('Older Excel files (.xls) aren\'t supported. In Excel, choose File > Save As > "Excel Workbook (.xlsx)" or CSV.');
  } else {
    throw new Error("Choose a CSV or Excel (.xlsx) file.");
  }

  if (grid.length < 2) throw new Error("The file needs a header row and at least one row of data.");
  const width = Math.max(...grid.map((r) => r.length));
  const headers = grid[0].map((h, i) => h || `Column ${i + 1}`);
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
  const rows = grid.slice(1).map((r) => headers.map((_, i) => r[i] ?? ""));
  if (rows.length > MAX_IMPORT_ROWS) {
    throw new Error(`That file has ${rows.length.toLocaleString("en-US")} rows. Import up to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} at a time by splitting the file.`);
  }
  return { headers, rows };
}

// ===========================================================================
// Reading values
// ===========================================================================

export type Parsed = { value: unknown } | { error: string };

const ok = (value: unknown): Parsed => ({ value });
const fail = (error: string): Parsed => ({ error });

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A valid local date as "YYYY-MM-DD", or null. */
const makeDate = (y: number, m: number, d: number): string | null => {
  if (y < 100) y += y < 70 ? 2000 : 1900;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 ? toISODate(date) : null;
};

/**
 * Dates in the formats people actually type or export: 2026-10-03,
 * 10/3/2026, 10/3/26, 10-3-2026, Oct 3 2026, 3 October 2026, and Excel's
 * date serial numbers. Slashes are read month first (US style).
 */
export const parseDate = (raw: string): Parsed => {
  const s = raw.trim().replace(/(\d)(st|nd|rd|th)\b/gi, "$1");
  let m: RegExpMatchArray | null;
  let iso: string | null = null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/))) iso = makeDate(+m[1], +m[2], +m[3]);
  else if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s.*)?$/))) iso = makeDate(+m[3], +m[1], +m[2]);
  else if ((m = s.match(/^([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{2,4})$/i)) && MONTHS.includes(m[1].slice(0, 3).toLowerCase()))
    iso = makeDate(+m[3], MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, +m[2]);
  else if ((m = s.match(/^(\d{1,2})\s+([a-z]{3,9})\.?,?\s+(\d{2,4})$/i)) && MONTHS.includes(m[2].slice(0, 3).toLowerCase()))
    iso = makeDate(+m[3], MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, +m[1]);
  else if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Excel serial date (days since Dec 30, 1899), e.g. from a CSV export of a date column.
    const n = Math.floor(Number(s));
    if (n > 20000 && n < 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      iso = makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
  }
  return iso ? ok(iso) : fail(`"${raw}" isn't a date we recognize. Use a format like 2026-10-03 or 10/3/2026.`);
};

/** "$1,234.50", "1234.5", "(USD) 50" -> 1234.5. Must be above zero. */
export const parseMoney = (raw: string): Parsed => {
  const s = raw.replace(/usd|\$|,|\s/gi, "");
  if (/^\(.*\)$/.test(s) || s.startsWith("-")) return fail(`"${raw}" is negative. Amounts must be above $0.`);
  const n = Number(s);
  if (!s || !Number.isFinite(n)) return fail(`"${raw}" isn't an amount.`);
  if (n <= 0) return fail("The amount must be above $0.");
  if (n > 100_000_000) return fail(`"${raw}" is too large.`);
  return ok(Math.round(n * 100) / 100);
};

const parseNumber = (raw: string, opts: { min: number; max: number; integer?: boolean; what: string; aboveMin?: boolean }): Parsed => {
  const n = Number(raw.replace(/,/g, "").trim());
  if (!raw.trim() || !Number.isFinite(n)) return fail(`"${raw}" isn't a number.`);
  if (opts.integer && !Number.isInteger(n)) return fail(`${opts.what} must be a whole number.`);
  if (opts.aboveMin ? n <= opts.min : n < opts.min) return fail(`${opts.what} must be ${opts.aboveMin ? "above" : "at least"} ${opts.min}.`);
  if (n > opts.max) return fail(`${opts.what} can't be more than ${opts.max.toLocaleString("en-US")}.`);
  return ok(opts.integer ? n : Math.round(n * 100) / 100);
};

const text = (max: number) => (raw: string): Parsed =>
  raw.length > max ? fail(`Too long (over ${max} characters).`) : ok(raw.trim());

/** Adds https:// when missing; only web addresses are accepted. */
export const parseUrl = (raw: string): Parsed => {
  const s = raw.trim();
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.hostname.includes(".")) throw new Error();
    return ok(url.toString());
  } catch {
    return fail(`"${raw}" isn't a web address.`);
  }
};

// ===========================================================================
// Record types
// ===========================================================================

export interface ImportField {
  key: string;
  label: string;
  required?: boolean;
  /** Header names that mean this field (compared without case, spaces or punctuation). */
  aliases: string[];
  /** Shown under the field in the matching step. */
  help?: string;
  /** Example value for the template file. */
  example: string;
  /** Reads a non-blank cell. Defaults to plain text. */
  parse?: (raw: string) => Parsed;
  /** Value when the cell is blank (optional fields only). */
  blank?: unknown;
}

export interface Importer {
  noun: string;
  plural: string;
  table: "donations" | "volunteer_hours" | "links" | "inventory_items";
  fields: ImportField[];
  /** Last adjustments once every field is read, e.g. a default title. */
  finish?: (values: Record<string, unknown>) => Record<string, unknown>;
  /** A problem with the row as a whole (after finish), or null. */
  validate?: (values: Record<string, unknown>) => string | null;
  /** Records with the same key count as duplicates. */
  duplicateKey: (values: Record<string, unknown>) => string;
  /** Keys of the organization's saved records. */
  loadExistingKeys: () => Promise<Set<string>>;
  /** Short description of a record for lists, e.g. "Jane Smith, $50.00, Oct 3, 2026". */
  describe: (values: Record<string, unknown>) => string;
}

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const money = (v: unknown) => Number(v ?? 0).toFixed(2);

/** Matches the Donations page's choices; anything else is kept in the notes. */
const PAYMENT_METHODS: Record<string, string> = {
  cash: "Cash",
  check: "Check",
  cheque: "Check",
  "credit card": "Credit Card",
  card: "Credit Card",
  "debit card": "Credit Card",
  credit: "Credit Card",
  "bank transfer": "Bank Transfer",
  ach: "Bank Transfer",
  wire: "Bank Transfer",
  "direct deposit": "Bank Transfer",
  paypal: "PayPal",
  venmo: "Venmo",
  other: "Other",
};

const CONDITIONS: Record<string, string> = {
  new: "new",
  "brand new": "new",
  "like new": "good",
  good: "good",
  used: "good",
  fair: "fair",
  ok: "fair",
  okay: "fair",
  poor: "poor",
  bad: "poor",
  damaged: "poor",
};

const fmtDate = (iso: unknown) =>
  typeof iso === "string" && iso
    ? new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "";

export const IMPORTERS = {
  donations: {
    noun: "donation",
    plural: "donations",
    table: "donations",
    fields: [
      { key: "donor_name", label: "Donor name", required: true, aliases: ["donor", "donor name", "name", "full name", "contributor", "giver", "from", "donated by"], example: "Jane Smith", parse: text(200) },
      { key: "amount", label: "Amount", required: true, aliases: ["amount", "gift", "gift amount", "donation", "donation amount", "total", "value", "amount usd"], example: "50.00", parse: parseMoney },
      { key: "date", label: "Date", required: true, aliases: ["date", "gift date", "donation date", "received", "date received", "received date"], example: "2026-10-03", parse: parseDate },
      { key: "campaign", label: "Campaign", aliases: ["campaign", "fund", "appeal", "designation", "program"], example: "Holiday Food Drive", parse: text(120), blank: null },
      {
        key: "payment_method",
        label: "Payment method",
        aliases: ["payment method", "method", "payment", "payment type", "type", "paid by", "tender"],
        help: "Cash, Check, Credit Card, Bank Transfer, PayPal, Venmo or Other. Anything else is saved as Other, with the original in the notes.",
        example: "Check",
        parse: (raw) => ok(raw.trim()),
        blank: null,
      },
      { key: "notes", label: "Notes", aliases: ["notes", "note", "memo", "comments", "comment", "description"], example: "Annual gift", parse: text(2000), blank: null },
    ],
    finish: (v) => {
      const method = typeof v.payment_method === "string" ? v.payment_method : "";
      if (!method) return v;
      const known = PAYMENT_METHODS[norm(method)];
      if (known) return { ...v, payment_method: known };
      return { ...v, payment_method: "Other", notes: [v.notes, `Payment method: ${method}`].filter(Boolean).join(" | ") };
    },
    duplicateKey: (v) => `${norm(v.donor_name)}|${money(v.amount)}|${v.date}`,
    loadExistingKeys: async () => {
      const rows = await fetchAll<{ donor_name: string; amount: number; date: string }>((f, t) =>
        supabase.from("donations").select("donor_name, amount, date").eq("is_sample", false).order("id").range(f, t),
      );
      return new Set(rows.map((r) => `${norm(r.donor_name)}|${money(r.amount)}|${r.date}`));
    },
    describe: (v) => `${v.donor_name}, $${money(v.amount)}, ${fmtDate(v.date)}`,
  },

  volunteer_hours: {
    noun: "volunteer entry",
    plural: "volunteer entries",
    table: "volunteer_hours",
    fields: [
      { key: "volunteer_name", label: "Volunteer name", required: true, aliases: ["volunteer", "volunteer name", "name", "full name", "person"], example: "Sam Lee", parse: text(200) },
      { key: "hours", label: "Hours", required: true, aliases: ["hours", "hrs", "time", "duration", "hours worked", "total hours"], help: "Above 0 and up to 24 per entry.", example: "3.5", parse: (raw) => parseNumber(raw, { min: 0, max: 24, what: "Hours", aboveMin: true }) },
      { key: "date", label: "Date", required: true, aliases: ["date", "shift date", "day", "date volunteered", "service date"], example: "2026-10-03", parse: parseDate },
      { key: "activity", label: "Activity", aliases: ["activity", "task", "role", "program", "project", "event", "assignment"], example: "Food sorting", parse: text(120), blank: null },
      { key: "notes", label: "Notes", aliases: ["notes", "note", "comments", "comment", "description"], example: "", parse: text(2000), blank: null },
    ],
    duplicateKey: (v) => `${norm(v.volunteer_name)}|${v.date}|${Number(v.hours).toFixed(2)}|${norm(v.activity)}`,
    loadExistingKeys: async () => {
      const rows = await fetchAll<{ volunteer_name: string; date: string; hours: number; activity: string | null }>((f, t) =>
        supabase.from("volunteer_hours").select("volunteer_name, date, hours, activity").eq("is_sample", false).order("id").range(f, t),
      );
      return new Set(rows.map((r) => `${norm(r.volunteer_name)}|${r.date}|${Number(r.hours).toFixed(2)}|${norm(r.activity)}`));
    },
    describe: (v) => `${v.volunteer_name}, ${v.hours} hrs, ${fmtDate(v.date)}${v.activity ? `, ${v.activity}` : ""}`,
  },

  links: {
    noun: "link",
    plural: "links",
    table: "links",
    fields: [
      { key: "url", label: "Web address", required: true, aliases: ["url", "link", "web address", "website", "address", "href", "site"], help: "https:// is added if it's missing.", example: "https://www.example.org", parse: parseUrl },
      { key: "title", label: "Title", aliases: ["title", "name", "label", "link name", "site name"], help: "If blank, the website's name is used.", example: "Example Partner", parse: text(200), blank: null },
      { key: "description", label: "Description", aliases: ["description", "notes", "note", "about", "details", "summary"], example: "Our main food supplier", parse: text(1000), blank: null },
      { key: "category", label: "Folder", aliases: ["folder", "category", "group", "type", "tag", "section"], example: "Partners", parse: text(80), blank: null },
    ],
    finish: (v) => (v.title ? v : { ...v, title: new URL(String(v.url)).hostname.replace(/^www\./, "") }),
    duplicateKey: (v) => norm(String(v.url).replace(/\/+$/, "")),
    loadExistingKeys: async () => {
      const rows = await fetchAll<{ url: string }>((f, t) => supabase.from("links").select("url").eq("is_sample", false).order("id").range(f, t));
      return new Set(rows.map((r) => norm(r.url.replace(/\/+$/, ""))));
    },
    describe: (v) => `${v.title}, ${v.url}`,
  },

  inventory_items: {
    noun: "inventory item",
    plural: "inventory items",
    table: "inventory_items",
    fields: [
      { key: "name", label: "Item name", required: true, aliases: ["name", "item", "item name", "product", "description of item", "title"], example: "Canned vegetables", parse: text(200) },
      { key: "quantity", label: "Quantity", required: true, aliases: ["quantity", "qty", "count", "amount", "on hand", "in stock", "stock", "units"], help: "A whole number, 0 or more.", example: "120", parse: (raw) => parseNumber(raw, { min: 0, max: 10_000_000, integer: true, what: "Quantity" }) },
      { key: "unit", label: "Unit", aliases: ["unit", "units of measure", "uom", "measure", "packaging"], example: "cans", parse: text(40), blank: null },
      { key: "category", label: "Category", aliases: ["category", "type", "group", "department", "kind"], example: "Food", parse: text(80), blank: null },
      {
        key: "condition",
        label: "Condition",
        aliases: ["condition", "state", "quality"],
        help: "New, Good, Fair or Poor. Anything else is left blank, with the original in the notes.",
        example: "New",
        parse: (raw) => ok(raw.trim()),
        blank: null,
      },
      { key: "location", label: "Location", aliases: ["location", "where", "shelf", "bin", "storage", "warehouse", "room"], example: "Shelf A", parse: text(120), blank: null },
      { key: "low_stock_threshold", label: "Restock at", aliases: ["restock at", "low stock threshold", "threshold", "reorder point", "reorder level", "minimum", "min", "par"], help: "Warn when stock falls to this number. Defaults to 5.", example: "20", parse: (raw) => parseNumber(raw, { min: 0, max: 10_000_000, integer: true, what: "Restock level" }), blank: 5 },
      { key: "description", label: "Description", aliases: ["description", "details", "about"], example: "", parse: text(1000), blank: null },
      { key: "notes", label: "Notes", aliases: ["notes", "note", "comments", "comment"], example: "", parse: text(2000), blank: null },
    ],
    finish: (v) => {
      const raw = typeof v.condition === "string" ? v.condition : "";
      if (!raw) return { ...v, condition: null };
      const known = CONDITIONS[norm(raw)];
      if (known) return { ...v, condition: known };
      return { ...v, condition: null, notes: [v.notes, `Condition: ${raw}`].filter(Boolean).join(" | ") };
    },
    duplicateKey: (v) => `${norm(v.name)}|${norm(v.location)}`,
    loadExistingKeys: async () => {
      const rows = await fetchAll<{ name: string; location: string | null }>((f, t) =>
        supabase.from("inventory_items").select("name, location").eq("is_sample", false).order("id").range(f, t),
      );
      return new Set(rows.map((r) => `${norm(r.name)}|${norm(r.location)}`));
    },
    describe: (v) => `${v.name}, ${v.quantity}${v.unit ? ` ${v.unit}` : ""}${v.location ? `, ${v.location}` : ""}`,
  },
} satisfies Record<string, Importer>;

export type ImportKind = keyof typeof IMPORTERS;

// ===========================================================================
// Matching columns and checking rows
// ===========================================================================

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Field key -> column index (or -1), guessed from the headers. Exact
 * matches win over partial ones, and each column is used at most once.
 */
export function autoMatch(importer: Importer, headers: string[]): Record<string, number> {
  const h = headers.map(squash);
  const used = new Set<number>();
  const result: Record<string, number> = {};
  const candidates = (f: ImportField) => [f.label, f.key, ...f.aliases].map(squash).filter(Boolean);

  for (const pass of ["exact", "partial"] as const) {
    for (const f of importer.fields) {
      if (result[f.key] !== undefined && result[f.key] >= 0) continue;
      const names = candidates(f);
      const index = h.findIndex(
        (col, i) => !used.has(i) && col && names.some((n) => (pass === "exact" ? col === n : n.length >= 4 && (col.includes(n) || n.includes(col)) && col.length >= 3)),
      );
      result[f.key] = index;
      if (index >= 0) used.add(index);
    }
  }
  return result;
}

export interface CheckedRow {
  /** Row number as people see it in their spreadsheet (header = row 1). */
  rowNumber: number;
  raw: string[];
  values: Record<string, unknown>;
  problems: string[];
  /** Why this looks like a duplicate, or null. */
  duplicate: string | null;
}

export function checkRows(importer: Importer, sheet: Sheet, mapping: Record<string, number>, existing: Set<string>): CheckedRow[] {
  const seen = new Map<string, number>();
  return sheet.rows.map((raw, i) => {
    const values: Record<string, unknown> = {};
    const problems: string[] = [];
    for (const f of importer.fields) {
      const col = mapping[f.key];
      const cell = col >= 0 ? (raw[col] ?? "").trim() : "";
      if (!cell) {
        if (f.required) problems.push(`${f.label} is missing.`);
        else values[f.key] = f.blank ?? null;
        continue;
      }
      const parsed = (f.parse ?? text(2000))(cell);
      if ("error" in parsed) problems.push(`${f.label}: ${parsed.error}`);
      else values[f.key] = parsed.value;
    }

    const rowNumber = i + 2;
    let finished = values;
    let duplicate: string | null = null;
    if (!problems.length) {
      finished = importer.finish ? importer.finish(values) : values;
      const rowProblem = importer.validate?.(finished);
      if (rowProblem) return { rowNumber: i + 2, raw, values: finished, problems: [rowProblem], duplicate: null };
      const key = importer.duplicateKey(finished);
      if (existing.has(key)) duplicate = "Already recorded";
      else if (seen.has(key)) duplicate = `Same as row ${seen.get(key)} in this file`;
      else seen.set(key, rowNumber);
    }
    return { rowNumber, raw, values: finished, problems, duplicate };
  });
}

// ===========================================================================
// The organization's own field setup
// ===========================================================================

const YES = new Set(["yes", "y", "true", "1", "x", "checked"]);
const NO = new Set(["no", "n", "false", "0", "unchecked"]);

/** How to read a cell for one of the organization's own fields. */
const customParser = (f: CustomField) => (raw: string): Parsed => {
  const s = raw.trim();
  switch (f.type) {
    case "number": {
      const n = Number(s.replace(/[$,]/g, ""));
      return Number.isFinite(n) ? ok(n) : fail(`"${raw}" isn't a number.`);
    }
    case "date":
      return parseDate(s);
    case "checkbox":
      return YES.has(s.toLowerCase()) ? ok(true) : NO.has(s.toLowerCase()) ? ok(false) : fail(`"${raw}" should be Yes or No.`);
    case "select": {
      const match = (f.options ?? []).find((o) => o.toLowerCase() === s.toLowerCase());
      return match ? ok(match) : fail(`"${raw}" isn't one of the options (${(f.options ?? []).join(", ")}).`);
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? ok(s) : fail(`"${raw}" isn't an email address.`);
    default:
      return s.length > (f.type === "textarea" ? 5000 : 500) ? fail("Too long.") : ok(s);
  }
};

const CUSTOM_PREFIX = "custom:";

/**
 * The importer for a record type, adjusted to the organization's field
 * setup. Without migration 011 (fields.isAvailable false) it's the standard
 * importer, so nothing is sent to columns that don't exist yet.
 */
export function buildImporter(kind: ImportKind, fields: TrackerFields): Importer {
  const base: Importer = IMPORTERS[kind];
  if (!fields.isAvailable) return base;

  const nameKey = NAME_FIELD[kind];
  const split = fields.splitNames && Boolean(nameKey);

  const builtIns: ImportField[] = base.fields
    .filter((f) => fields.shows(f.key))
    .flatMap((f): ImportField[] => {
      const label = fields.label(f.key);
      const renamed = { ...f, label, aliases: label === f.label ? f.aliases : [...f.aliases, f.label] };
      if (split && f.key === nameKey) {
        return [
          { key: "first_name", label: "First name", aliases: ["first name", "first", "given name", "firstname", "fname"], example: "Jane", parse: (raw) => ok(raw.trim().slice(0, 100)), blank: "" },
          { key: "last_name", label: "Last name", aliases: ["last name", "last", "surname", "family name", "lastname", "lname"], example: "Smith", parse: (raw) => ok(raw.trim().slice(0, 100)), blank: "" },
        ];
      }
      return [renamed];
    });

  const customs: ImportField[] = fields.custom.map((f) => ({
    key: `${CUSTOM_PREFIX}${f.id}`,
    label: f.label,
    required: Boolean(f.required) && f.type !== "checkbox",
    aliases: [f.label],
    help: f.type === "select" ? `One of: ${(f.options ?? []).join(", ")}.` : f.type === "checkbox" ? "Yes or No." : undefined,
    example: f.type === "number" ? "1" : f.type === "date" ? "2026-10-03" : f.type === "checkbox" ? "Yes" : f.type === "select" ? f.options?.[0] ?? "" : "",
    parse: customParser(f),
    blank: null,
  }));

  return {
    ...base,
    fields: [...builtIns, ...customs],
    finish: (v) => {
      const values: Record<string, unknown> = {};
      const custom: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (k.startsWith(CUSTOM_PREFIX)) {
          if (val !== null && val !== undefined && val !== "") custom[k.slice(CUSTOM_PREFIX.length)] = val;
        } else values[k] = val;
      }
      values.custom = custom;
      if (nameKey) {
        if (split) {
          values[nameKey] = joinName(String(values.first_name ?? ""), String(values.last_name ?? ""));
          values.first_name = String(values.first_name ?? "").trim() || null;
          values.last_name = String(values.last_name ?? "").trim() || null;
        } else {
          const { first, last } = splitName(String(values[nameKey] ?? ""));
          values.first_name = first || null;
          values.last_name = last || null;
        }
      }
      return base.finish ? base.finish(values) : values;
    },
    validate: (v) => (split && nameKey && !String(v[nameKey] ?? "").trim() ? "First name or last name is missing." : base.validate?.(v) ?? null),
  };
}

/** A CSV template with the right headers and one example row. */
export const templateRows = (importer: Importer): string[][] => [importer.fields.map((f) => f.label), importer.fields.map((f) => f.example)];
