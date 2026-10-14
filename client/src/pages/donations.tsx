/**
 * DonationsPage
 *
 * Lets a signed-in user record, edit, delete, search, chart and export the
 * donations their organization has received. All rows are stored in the
 * Supabase "donations" table and are shared with everyone in the organization.
 *
 * Main sections of the page, top to bottom:
 *   1. Header with "Export CSV" and "Record donation" actions
 *   2. Summary stats (total raised, this month, unique donors, count, average gift)
 *   3. Bar chart of totals per campaign (top 10)
 *   4. Searchable table of donations with edit/delete actions
 *   5. Add/edit dialog and a delete confirmation dialog
 *
 * Assumptions about the backend:
 *   - Table "donations" has the columns listed in the Donation interface plus user_id.
 *   - Migration 011 adds custom, first_name and last_name. Until it has run,
 *     fields.isAvailable is false and those columns are never sent.
 *   - Row Level Security (RLS) limits rows to the user's organization and
 *     blocks changes from viewers. user_id records who created the row; it
 *     isn't used for access.
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { friendlyWriteError } from "@/lib/db-errors";
import { Plus, DollarSign, Trash2, Pencil, Download, TrendingUp, Search, Upload } from "lucide-react";
import { ImportDialog } from "@/components/import-dialog";
import { CustomFieldInputs, SplitNameInputs } from "@/components/custom-field-inputs";
import { CustomizeFieldsButton } from "@/components/customize-fields-dialog";
import {
  useTrackerFields,
  prepareCustomValues,
  customOf,
  formatCustomValue,
  joinName,
  splitName,
  type CustomValues,
} from "@/lib/tracker-fields";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of a row in the Supabase "donations" table (user_id omitted on read). */
interface Donation {
  id: string;
  donor_name: string;
  /** Postgres numeric columns can come back as strings, so always wrap in Number(). */
  amount: number;
  /** Calendar date stored as "YYYY-MM-DD" (no time zone). */
  date: string;
  campaign: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
  /** Organization-defined field values keyed by field id (migration 011). */
  custom?: CustomValues | null;
  /** Set when names are split; donor_name is still saved as "First Last". */
  first_name?: string | null;
  last_name?: string | null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Options for the payment method dropdown. */
const PAYMENT_METHODS = ["Cash", "Check", "Credit Card", "Bank Transfer", "PayPal", "Venmo", "Other"];

/**
 * Radix Select does not allow an item with an empty-string value, so this
 * sentinel represents "no payment method" and is converted back to "" on change.
 */
const NO_METHOD = "__none__";

/** Upper bound on a single gift, to catch typos like an extra few zeros. */
const MAX_AMOUNT = 10_000_000;

/** How many campaigns to show in the chart before it becomes unreadable. */
const MAX_CHART_CAMPAIGNS = 10;

/** Campaign names longer than this are shortened on the chart axis only. */
const MAX_AXIS_LABEL_LENGTH = 14;

// ---------------------------------------------------------------------------
// Helpers (pure functions, defined outside the component so they are not
// recreated on every render)
// ---------------------------------------------------------------------------

/**
 * Today's date as "YYYY-MM-DD" in the user's LOCAL time zone.
 *
 * The original code used new Date().toISOString(), which is UTC. In the
 * evening in US time zones that returns tomorrow's date, so new donations
 * were pre-filled with the wrong day.
 */
const todayLocal = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

/**
 * Parse "YYYY-MM-DD" as a LOCAL date at midnight.
 *
 * new Date("2026-10-01") is interpreted as UTC midnight, which shifts to the
 * previous day in negative-offset time zones. Building the Date from parts
 * avoids that off-by-one bug.
 */
const parseLocalDate = (iso: string): Date => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** Shared USD formatter; always shows exactly two decimal places. */
const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const formatCurrency = (value: number): string => currencyFormatter.format(value);

/**
 * Escape a single value for a CSV cell.
 *
 * - Doubles any embedded quotes (the original code broke on names like
 *   'Robert "Bob" Smith', producing a malformed file).
 * - Prefixes text that starts with =, +, -, @, tab or carriage return with an
 *   apostrophe to block spreadsheet formula injection when the file is opened
 *   in Excel or Google Sheets. Numbers are left untouched.
 */
const csvCell = (value: unknown): string => {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return `"${text.replace(/"/g, '""')}"`;
};

/** Normalize donor names so "Jane Smith" and " jane smith " count as one donor. */
const normalizeName = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DonationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  /** False for viewers and for read-only organizations; hides add/edit/delete controls. */
  const { canEdit } = useOrganization();
  /** Organization's field settings: renamed labels, hidden fields, split names, custom fields. */
  const fields = useTrackerFields("donations");
  /** Import window (CSV or Excel). */
  const [showImport, setShowImport] = useState(false);

  // ----- Data state -----
  const [donations, setDonations] = useState<Donation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ----- Table filter state -----
  const [searchQuery, setSearchQuery] = useState("");

  // ----- Add/edit dialog state -----
  const [showDialog, setShowDialog] = useState(false);
  /** When non-null, the dialog is editing this donation instead of creating one. */
  const [editingDonation, setEditingDonation] = useState<Donation | null>(null);
  const [donorName, setDonorName] = useState("");
  /** Used instead of donorName when fields.splitNames is on. */
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayLocal());
  const [campaign, setCampaign] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [customValues, setCustomValues] = useState<CustomValues>({});
  /** Problems with custom values from the last save attempt, keyed by field id. */
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  // ----- Delete confirmation state -----
  /** The donation the user clicked delete on; drives the confirmation dialog. */
  const [pendingDelete, setPendingDelete] = useState<Donation | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  /**
   * Fetch all of the current user's donations, newest first.
   *
   * Fixes over the original:
   * - Errors were silently ignored; they now surface as a toast.
   * - If there was no user, isLoading stayed true forever and the skeleton
   *   never went away. It now resolves to an empty list.
   * - Wrapped in useCallback so it can be listed as an effect dependency.
   */
  const loadDonations = useCallback(async () => {
    if (!user) {
      setDonations([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const { data, error } = await supabase
      .from("donations")
      .select("*")
      .order("date", { ascending: false })
      // Secondary sort keeps same-day donations in a stable, predictable order.
      .order("created_at", { ascending: false });

    if (error) {
      toast({ title: "Could not load donations", description: error.message, variant: "destructive" });
    } else {
      setDonations(data ?? []);
    }
    setIsLoading(false);
  }, [user, toast]);

  // Reload whenever the signed-in user changes (login, logout, account switch).
  useEffect(() => {
    loadDonations();
  }, [loadDonations]);

  // -------------------------------------------------------------------------
  // Form helpers
  // -------------------------------------------------------------------------

  /** Clear every form field and close the add/edit dialog. */
  const resetForm = () => {
    setDonorName("");
    setFirstName("");
    setLastName("");
    setAmount("");
    setDate(todayLocal());
    setCampaign("");
    setPaymentMethod("");
    setNotes("");
    setCustomValues({});
    setCustomErrors({});
    setEditingDonation(null);
    setShowDialog(false);
  };

  /** Open the dialog in "create" mode with a clean form. */
  const openCreate = () => {
    resetForm();
    setShowDialog(true);
  };

  /** Open the dialog in "edit" mode, pre-filled with an existing donation. */
  const openEdit = (d: Donation) => {
    setEditingDonation(d);
    setDonorName(d.donor_name);
    // Rows saved before names were split have no first/last yet; guess from the full name.
    const guess = splitName(d.donor_name);
    const hasSplit = d.first_name != null || d.last_name != null;
    setFirstName(hasSplit ? (d.first_name ?? "") : guess.first);
    setLastName(hasSplit ? (d.last_name ?? "") : guess.last);
    setAmount(String(d.amount));
    setDate(d.date);
    setCampaign(d.campaign ?? "");
    setPaymentMethod(d.payment_method ?? "");
    setNotes(d.notes ?? "");
    setCustomValues(customOf(d));
    setCustomErrors({});
    setShowDialog(true);
  };

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * The original only checked that the amount field was non-empty, so values
   * like "0", "-50" or "1e9" could be saved. This validates the parsed number.
   */
  const parsedAmount = Number(amount);
  const amountError: string | null =
    amount === ""
      ? null // Empty is handled by disabling the button; no message needed yet.
      : !Number.isFinite(parsedAmount) || parsedAmount <= 0
        ? "Enter an amount greater than $0."
        : parsedAmount > MAX_AMOUNT
          ? `Amount cannot exceed ${formatCurrency(MAX_AMOUNT)}.`
          : null;

  /** In split mode, at least a first or last name is required. */
  const hasName = fields.splitNames ? joinName(firstName, lastName) !== "" : donorName.trim() !== "";

  const isFormValid = hasName && amount !== "" && amountError === null && date !== "";

  // -------------------------------------------------------------------------
  // Create / update
  // -------------------------------------------------------------------------

  /**
   * Insert a new donation or update the one being edited.
   *
   * Fixes over the original:
   * - Uses try/finally so the "Saving..." state always clears, even if the
   *   request throws (network failure) instead of returning an error object.
   * - Rounds the amount to cents to avoid floating point values like 10.004.
   * - Editing keeps the original creator: user_id is only set on new rows.
   * - Hidden fields are left out of the payload, so values saved before a
   *   field was hidden are kept on edit.
   * - custom/first_name/last_name are only sent once migration 011 has run.
   */
  const handleSave = async () => {
    if (!user || !isFormValid) return;

    const prepared = prepareCustomValues(fields.custom, customValues);
    setCustomErrors(prepared.errors);
    if (Object.keys(prepared.errors).length > 0) return;

    const fullName = fields.splitNames ? joinName(firstName, lastName) : donorName.trim();

    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = {
        donor_name: fullName,
        amount: Math.round(parsedAmount * 100) / 100,
        date,
      };
      if (fields.shows("campaign")) payload.campaign = campaign.trim() || null;
      if (fields.shows("payment_method")) payload.payment_method = paymentMethod || null;
      if (fields.shows("notes")) payload.notes = notes.trim() || null;
      if (fields.isAvailable) {
        // Keep first/last consistent with donor_name in both modes.
        const parts = fields.splitNames ? { first: firstName.trim(), last: lastName.trim() } : splitName(fullName);
        payload.first_name = parts.first || null;
        payload.last_name = parts.last || null;
        payload.custom = prepared.values;
      }

      const { error } = editingDonation
        ? await supabase
            .from("donations")
            .update(payload)
            .eq("id", editingDonation.id)
        : await supabase.from("donations").insert({ ...payload, user_id: user.id });

      if (error) {
        toast({ title: "Could not save donation", description: friendlyWriteError(error), variant: "destructive" });
        return;
      }

      toast({ title: editingDonation ? "Donation updated" : "Donation recorded" });
      resetForm();
      await loadDonations();
    } catch (err) {
      toast({
        title: "Could not save donation",
        description: friendlyWriteError(err instanceof Error ? err : null, "Check your connection and try again."),
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------------

  /**
   * Delete the donation held in pendingDelete.
   *
   * The original deleted immediately on a single click of the trash icon,
   * which made accidental, unrecoverable deletes easy. Deletion now goes
   * through a confirmation dialog first.
   */
  const confirmDelete = async () => {
    if (!user || !pendingDelete) return;

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from("donations")
        .delete()
        .eq("id", pendingDelete.id);

      if (error) {
        toast({ title: "Could not delete donation", description: friendlyWriteError(error), variant: "destructive" });
        return;
      }

      toast({ title: "Donation deleted" });
      setPendingDelete(null);
      await loadDonations();
    } catch (err) {
      toast({
        title: "Could not delete donation",
        description: friendlyWriteError(err instanceof Error ? err : null, "Check your connection and try again."),
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Derived data (memoized so large lists are not re-processed on every keystroke)
  // -------------------------------------------------------------------------

  /** Donations matching the search box (donor, campaign, method, notes or custom field text). */
  const filteredDonations = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return donations;
    return donations.filter((d) =>
      [
        d.donor_name,
        d.campaign,
        d.payment_method,
        d.notes,
        ...fields.custom.map((f) => formatCustomValue(f, customOf(d)[f.id])),
      ].some((field) => field?.toLowerCase().includes(q)),
    );
  }, [donations, searchQuery, fields.custom]);

  /**
   * Summary numbers for the stat cards. These always use ALL donations,
   * not the filtered list, so the headline figures do not jump around while
   * the user is searching.
   */
  const stats = useMemo(() => {
    const totalAmount = donations.reduce((sum, d) => sum + Number(d.amount), 0);

    // "This month" now means the current calendar month. The original used
    // "the last 30 days" while labeling it "This Month", and parsed dates as
    // UTC, which could drop or include donations on the boundary day.
    const now = new Date();
    const thisMonthAmount = donations
      .filter((d) => {
        const dt = parseLocalDate(d.date);
        return dt.getFullYear() === now.getFullYear() && dt.getMonth() === now.getMonth();
      })
      .reduce((sum, d) => sum + Number(d.amount), 0);

    // Normalized so capitalization and extra spaces do not create duplicate donors.
    const uniqueDonors = new Set(donations.map((d) => normalizeName(d.donor_name))).size;

    const averageGift = donations.length > 0 ? totalAmount / donations.length : 0;

    return { totalAmount, thisMonthAmount, uniqueDonors, averageGift, count: donations.length };
  }, [donations]);

  /**
   * Totals per campaign for the bar chart, largest first, capped at
   * MAX_CHART_CAMPAIGNS. Donations without a campaign are grouped as "General".
   *
   * Each entry keeps the full name for the tooltip and a shortened label for
   * the axis. The original replaced the name entirely, so the tooltip showed
   * the truncated text too.
   */
  const chartData = useMemo(() => {
    const byCampaign = donations.reduce<Record<string, number>>((acc, d) => {
      const key = d.campaign?.trim() || "General";
      acc[key] = (acc[key] ?? 0) + Number(d.amount);
      return acc;
    }, {});

    return Object.entries(byCampaign)
      .map(([fullName, total]) => ({
        fullName,
        label: fullName.length > MAX_AXIS_LABEL_LENGTH ? `${fullName.slice(0, MAX_AXIS_LABEL_LENGTH)}...` : fullName,
        total,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, MAX_CHART_CAMPAIGNS);
  }, [donations]);

  /** Distinct existing campaign names, offered as suggestions in the form. */
  const campaignSuggestions = useMemo(
    () => Array.from(new Set(donations.map((d) => d.campaign).filter((c): c is string => Boolean(c)))).sort(),
    [donations],
  );

  // -------------------------------------------------------------------------
  // CSV export
  // -------------------------------------------------------------------------

  /**
   * Download the donations currently shown in the table as a CSV file.
   *
   * Fixes over the original:
   * - Values are properly escaped (see csvCell).
   * - A UTF-8 byte order mark is added so Excel shows accented names correctly.
   * - Uses CRLF line endings, which is the CSV standard and what Excel expects.
   * - The file name includes today's date so repeated exports do not collide.
   * - The object URL is revoked after a short delay; revoking it immediately
   *   after click() can cancel the download in some browsers.
   * - Exports the filtered list, so a search doubles as a quick report filter.
   */
  const exportCSV = () => {
    // Columns follow the organization's field settings: renamed labels,
    // hidden built-ins skipped, custom fields appended as formatted text.
    const columns: { header: string; value: (d: Donation) => unknown }[] = [
      { header: fields.label("donor_name"), value: (d) => d.donor_name },
      ...(fields.splitNames
        ? [
            { header: "First name", value: (d: Donation) => d.first_name ?? splitName(d.donor_name).first },
            { header: "Last name", value: (d: Donation) => d.last_name ?? splitName(d.donor_name).last },
          ]
        : []),
      { header: fields.label("amount"), value: (d) => Number(d.amount).toFixed(2) },
      { header: fields.label("date"), value: (d) => d.date },
      ...(fields.shows("campaign") ? [{ header: fields.label("campaign"), value: (d: Donation) => d.campaign ?? "" }] : []),
      ...(fields.shows("payment_method")
        ? [{ header: fields.label("payment_method"), value: (d: Donation) => d.payment_method ?? "" }]
        : []),
      ...(fields.shows("notes") ? [{ header: fields.label("notes"), value: (d: Donation) => d.notes ?? "" }] : []),
      ...fields.custom.map((f) => ({ header: f.label, value: (d: Donation) => formatCustomValue(f, customOf(d)[f.id]) })),
    ];
    const headers = columns.map((c) => c.header);
    const rows = filteredDonations.map((d) => columns.map((c) => c.value(d)));

    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `donations-${todayLocal()}.csv`;
    document.body.appendChild(link); // Firefox requires the link to be in the DOM.
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /** Number of table columns, so the "no matches" row spans the whole table. */
  const columnCount =
    3 +
    ["campaign", "payment_method", "notes"].filter((k) => fields.shows(k)).length +
    fields.custom.length +
    (canEdit ? 1 : 0);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ===== Header: title and primary actions ===== */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Donation Log</h1>
          <p className="text-muted-foreground">Track donations by donor, campaign, and payment method</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Only offer export when there is something to export. */}
          {filteredDonations.length > 0 && (
            <Button variant="outline" onClick={exportCSV}>
              <Download className="mr-1 h-4 w-4" aria-hidden="true" /> Export CSV
            </Button>
          )}
          {/* Renders only for owners and admins. */}
          <CustomizeFieldsButton fields={fields} />
          {canEdit && (
            <>
              <Button variant="outline" onClick={() => setShowImport(true)}>
                <Upload className="mr-1 h-4 w-4" aria-hidden="true" /> Import
              </Button>
              <Button onClick={openCreate}>
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Record donation
              </Button>
            </>
          )}
        </div>
      </div>
      {showImport && <ImportDialog kind="donations" onClose={() => setShowImport(false)} onImported={loadDonations} />}
      <ReadOnlyNotice />

      {/* ===== Summary stats ===== */}
      {/* Skeletons while loading, so the cards do not briefly show $0.00. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-[76px] w-full" />)
          : [
              { label: "Total raised", value: formatCurrency(stats.totalAmount) },
              { label: "This month", value: formatCurrency(stats.thisMonthAmount) },
              { label: "Unique donors", value: stats.uniqueDonors.toLocaleString() },
              { label: "Total donations", value: stats.count.toLocaleString() },
              { label: "Average gift", value: formatCurrency(stats.averageGift) },
            ].map((stat) => (
              <Card key={stat.label} className="p-4 text-center">
                <p className="text-xl font-bold text-primary">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
              </Card>
            ))}
      </div>

      {/* ===== Chart: totals by campaign (hidden along with the campaign field) ===== */}
      {!isLoading && fields.shows("campaign") && chartData.length > 0 && (
        <Card className="p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden="true" /> Donations by{" "}
            {fields.label("campaign").toLowerCase()}
          </h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis
                  tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                  tickFormatter={(v) => `$${Number(v).toLocaleString()}`}
                  width={72}
                />
                <Tooltip
                  formatter={(v) => [formatCurrency(Number(v)), "Total"]}
                  // Show the full, untruncated campaign name as the tooltip title.
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                  contentStyle={{
                    backgroundColor: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "6px",
                  }}
                />
                {/* Uses the theme's primary color instead of a hard-coded blue, so it follows dark mode. */}
                <Bar dataKey="total" radius={[4, 4, 0, 0]} fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ===== Donations table (or loading / empty states) ===== */}
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : donations.length > 0 ? (
        <div className="space-y-3">
          {/* Search box filters the table and the CSV export. */}
          <div className="relative max-w-sm">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Search donor, campaign, method, notes"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Search donations"
            />
          </div>

          <Card className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{fields.label("donor_name")}</TableHead>
                  <TableHead className="text-right">{fields.label("amount")}</TableHead>
                  <TableHead>{fields.label("date")}</TableHead>
                  {fields.shows("campaign") && <TableHead>{fields.label("campaign")}</TableHead>}
                  {fields.shows("payment_method") && <TableHead>{fields.label("payment_method")}</TableHead>}
                  {fields.shows("notes") && <TableHead>{fields.label("notes")}</TableHead>}
                  {fields.custom.map((f) => (
                    <TableHead key={f.id}>{f.label}</TableHead>
                  ))}
                  {canEdit && <TableHead className="w-20">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDonations.length === 0 ? (
                  // Search returned nothing: explain why the table is empty.
                  <TableRow>
                    <TableCell colSpan={columnCount} className="py-10 text-center text-muted-foreground">
                      No donations match "{searchQuery}".
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredDonations.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="font-medium">{d.donor_name}</TableCell>
                      <TableCell className="text-right font-semibold text-primary whitespace-nowrap">
                        {formatCurrency(Number(d.amount))}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{parseLocalDate(d.date).toLocaleDateString()}</TableCell>
                      {fields.shows("campaign") && (
                        <TableCell>{d.campaign ? <Badge variant="secondary">{d.campaign}</Badge> : "-"}</TableCell>
                      )}
                      {fields.shows("payment_method") && <TableCell>{d.payment_method ?? "-"}</TableCell>}
                      {/* title attribute shows the full note on hover since the cell is truncated. */}
                      {fields.shows("notes") && (
                        <TableCell className="max-w-[150px] truncate text-muted-foreground" title={d.notes ?? undefined}>
                          {d.notes ?? "-"}
                        </TableCell>
                      )}
                      {fields.custom.map((f) => {
                        const text = formatCustomValue(f, customOf(d)[f.id]);
                        return (
                          <TableCell key={f.id} className="max-w-[150px] truncate" title={text || undefined}>
                            {text || "-"}
                          </TableCell>
                        );
                      })}
                      {canEdit && (
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {/* aria-labels give screen readers a name for these icon-only buttons. */}
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(d)}
                              aria-label={`Edit donation from ${d.donor_name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setPendingDelete(d)}
                              aria-label={`Delete donation from ${d.donor_name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        </div>
      ) : (
        // Empty state: no donations at all yet.
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <DollarSign className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No donations recorded</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              {canEdit
                ? "Start tracking donations to generate reports for your board and grant applications."
                : "Donations your organization records will appear here."}
            </p>
          </div>
          {canEdit && (
            <Button onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Record first donation
            </Button>
          )}
        </div>
      )}

      {/* ===== Add / edit dialog ===== */}
      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          // Block closing mid-save so the form is not wiped while a request is in flight.
          if (!open && !isSaving) resetForm();
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingDonation ? "Edit donation" : "Record donation"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              {/* Donor name (required). htmlFor/id pairs make labels clickable and accessible.
                  Shown as First + Last boxes when the organization splits names. */}
              <div className="space-y-2 col-span-2">
                {fields.splitNames ? (
                  <SplitNameInputs
                    first={firstName}
                    last={lastName}
                    onFirst={setFirstName}
                    onLast={setLastName}
                    idPrefix="donation-donor"
                    autoFocus
                  />
                ) : (
                  <>
                    <Label htmlFor="donation-donor">{fields.label("donor_name")}</Label>
                    <Input
                      id="donation-donor"
                      placeholder="Jane Smith"
                      value={donorName}
                      onChange={(e) => setDonorName(e.target.value)}
                      maxLength={200}
                      autoFocus
                    />
                  </>
                )}
              </div>

              {/* Amount (required, validated above). */}
              <div className="space-y-2">
                <Label htmlFor="donation-amount">{fields.label("amount")} ($)</Label>
                <Input
                  id="donation-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-invalid={amountError !== null}
                  aria-describedby={amountError ? "donation-amount-error" : undefined}
                />
                {amountError && (
                  <p id="donation-amount-error" className="text-xs text-destructive">
                    {amountError}
                  </p>
                )}
              </div>

              {/* Date (required). max prevents accidentally logging a future date. */}
              <div className="space-y-2">
                <Label htmlFor="donation-date">{fields.label("date")}</Label>
                <Input
                  id="donation-date"
                  type="date"
                  value={date}
                  max={todayLocal()}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            {/* Campaign (optional) with suggestions from previously used campaigns. */}
            {fields.shows("campaign") && (
              <div className="space-y-2">
                <Label htmlFor="donation-campaign">
                  {fields.label("campaign")} <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="donation-campaign"
                  placeholder="Annual Fund, Summer Drive..."
                  value={campaign}
                  onChange={(e) => setCampaign(e.target.value)}
                  list="campaign-suggestions"
                  maxLength={100}
                />
                <datalist id="campaign-suggestions">
                  {campaignSuggestions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            )}

            {/* Payment method (optional). Includes a "None" option so a choice can be cleared. */}
            {fields.shows("payment_method") && (
              <div className="space-y-2">
                <Label htmlFor="donation-method">
                  {fields.label("payment_method")} <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Select
                  value={paymentMethod || NO_METHOD}
                  onValueChange={(v) => setPaymentMethod(v === NO_METHOD ? "" : v)}
                >
                  <SelectTrigger id="donation-method">
                    <SelectValue placeholder="Select method..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_METHOD}>None</SelectItem>
                    {PAYMENT_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Organization-defined fields (renders nothing when there are none). */}
            <CustomFieldInputs
              fields={fields.custom}
              values={customValues}
              onChange={setCustomValues}
              errors={customErrors}
              idPrefix="donation-custom"
            />

            {/* Notes (optional). */}
            {fields.shows("notes") && (
              <div className="space-y-2">
                <Label htmlFor="donation-notes">
                  {fields.label("notes")} <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Textarea
                  id="donation-notes"
                  placeholder="Any additional notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  maxLength={1000}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetForm} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!isFormValid || isSaving}>
              {isSaving ? "Saving..." : editingDonation ? "Save changes" : "Record donation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== Delete confirmation dialog ===== */}
      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setPendingDelete(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this donation?</DialogTitle>
            <DialogDescription>
              {pendingDelete && (
                <>
                  {formatCurrency(Number(pendingDelete.amount))} from {pendingDelete.donor_name} on{" "}
                  {parseLocalDate(pendingDelete.date).toLocaleDateString()} will be permanently removed. This
                  cannot be undone.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : "Delete donation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}