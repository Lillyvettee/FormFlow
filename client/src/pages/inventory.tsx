/**
 * InventoryPage
 *
 * Tracks donated supplies, equipment and resources for the signed-in user.
 * Items are stored in the Supabase "inventory_items" table.
 *
 * Features:
 *   - Three views: card grid, table, and a stock-level bar chart
 *   - Quick +/- quantity buttons with optimistic updates
 *   - Per-item low-stock threshold, with an alert banner for low and empty items
 *   - Search and stock-status filter
 *   - Add/edit dialog and a delete confirmation dialog
 *
 * Backend assumptions:
 *   - Columns: id, user_id, name, description, quantity (integer), unit,
 *     category, condition, location, notes, low_stock_threshold (integer).
 *   - Row Level Security restricts every row to its owner. The extra
 *     .eq("user_id", ...) filters below are a second line of defense.
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
import {
  Plus,
  Package,
  Trash2,
  Pencil,
  LayoutGrid,
  List,
  Minus,
  AlertTriangle,
  BarChart3,
  MapPin,
  Tag,
  Search,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { InventoryItem } from "@/types/database";

// ===========================================================================
// Types
// ===========================================================================

type ViewMode = "grid" | "table" | "chart";

/** Filter options for the stock-status dropdown above the list. */
type StockFilter = "all" | "low" | "out" | "in";

/**
 * InventoryItem plus the low_stock_threshold column, which the generated
 * database type does not include yet. Replaces the original `as any` casts.
 * If you regenerate your Supabase types, this can be removed.
 */
type ItemWithThreshold = InventoryItem & { low_stock_threshold?: number | null };

/** What a stock-status badge needs to render. */
interface StockStatus {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  className?: string;
}

// ===========================================================================
// Constants
// ===========================================================================

/** Item condition choices, with the badge style used to show each one. */
const CONDITION_OPTIONS = [
  { value: "new", label: "New", variant: "default" as const },
  { value: "good", label: "Good", variant: "secondary" as const },
  { value: "fair", label: "Fair", variant: "secondary" as const },
  { value: "poor", label: "Poor", variant: "destructive" as const },
];

/** Threshold used when an item has none saved. */
const DEFAULT_LOW_STOCK_THRESHOLD = 5;

/** Upper bound for quantities, to catch typos like an extra few zeros. */
const MAX_QUANTITY = 1_000_000;

/** Chart axis labels longer than this are shortened (the tooltip shows the full name). */
const MAX_AXIS_LABEL_LENGTH = 12;

/** localStorage key that remembers the user's preferred view between visits. */
const VIEW_MODE_STORAGE_KEY = "inventory-view-mode";

/** Labels and icons for the view switcher. */
const VIEW_OPTIONS: { value: ViewMode; label: string; icon: typeof LayoutGrid }[] = [
  { value: "grid", label: "Grid view", icon: LayoutGrid },
  { value: "table", label: "Table view", icon: List },
  { value: "chart", label: "Chart view", icon: BarChart3 },
];

// ===========================================================================
// Stock helpers (pure functions, outside the component)
// ===========================================================================

/** The item's low-stock threshold, falling back to the default. */
const getThreshold = (item: InventoryItem): number =>
  (item as ItemWithThreshold).low_stock_threshold ?? DEFAULT_LOW_STOCK_THRESHOLD;

/** Quantity as a number. Postgres numeric values can arrive as strings. */
const getQty = (item: InventoryItem): number => Number(item.quantity) || 0;

const isOutOfStock = (item: InventoryItem): boolean => getQty(item) <= 0;

/** Above zero but at or below the item's threshold. */
const isLowStock = (item: InventoryItem): boolean => {
  const qty = getQty(item);
  return qty > 0 && qty <= getThreshold(item);
};

/** True for anything that needs attention (low or empty). */
const needsRestock = (item: InventoryItem): boolean => isLowStock(item) || isOutOfStock(item);

/**
 * Badge text and style for an item's stock level.
 * Low stock now uses an amber outline instead of the same red as "Out of
 * stock", so the two states can be told apart at a glance.
 */
const getStockStatus = (item: InventoryItem): StockStatus => {
  if (isOutOfStock(item)) return { label: "Out of stock", variant: "destructive" };
  if (isLowStock(item)) {
    return {
      label: "Low stock",
      variant: "outline",
      className: "border-amber-500 text-amber-700 dark:text-amber-400",
    };
  }
  return { label: "In stock", variant: "default" };
};

/**
 * Fill percentage for the small stock bar on each card.
 *
 * The original divided quantity by max(quantity, 20), so any item with 20 or
 * more was always shown as 100% full and the bar carried no information.
 * The bar is now relative to three times the low-stock threshold: an item at
 * its threshold shows about one third full, and anything well stocked fills it.
 */
const getStockPercent = (item: InventoryItem): number => {
  const fullLevel = Math.max(getThreshold(item) * 3, 1);
  return Math.min(100, (getQty(item) / fullLevel) * 100);
};

/** "3 boxes", or "3 units" when no unit is set. */
const formatQty = (qty: number, unit?: string | null): string => `${qty} ${unit?.trim() || (qty === 1 ? "unit" : "units")}`;

/** Read the saved view mode, ignoring bad values or blocked storage. */
const loadSavedViewMode = (): ViewMode => {
  try {
    const saved = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    if (saved === "grid" || saved === "table" || saved === "chart") return saved;
  } catch {
    // Storage can be unavailable (private browsing, strict settings); use the default.
  }
  return "grid";
};

// ===========================================================================
// Component
// ===========================================================================

export default function InventoryPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ----- Data state -----
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ----- View and filter state -----
  const [viewMode, setViewMode] = useState<ViewMode>(loadSavedViewMode);
  const [searchQuery, setSearchQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");

  // ----- Add/edit dialog state -----
  const [showDialog, setShowDialog] = useState(false);
  /** When non-null, the dialog edits this item instead of creating a new one. */
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  /**
   * Numeric fields are kept as strings while typing. The original stored
   * numbers and used parseInt(...) || 0, so the field could never be cleared
   * (it snapped back to 0) and typing "5" produced "05".
   */
  const [quantityText, setQuantityText] = useState("0");
  const [thresholdText, setThresholdText] = useState(String(DEFAULT_LOW_STOCK_THRESHOLD));
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("good");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // ----- Quick-adjust and delete state -----
  /** Id of the item whose quantity is being saved; disables its +/- buttons meanwhile. */
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<InventoryItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  /**
   * Load all of the user's items, sorted by name.
   *
   * Fixes over the original:
   * - Errors were ignored; they now show a toast.
   * - With no user, the loading skeleton never went away.
   * - useCallback so it can be an effect dependency.
   */
  const loadItems = useCallback(async () => {
    if (!user) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const { data, error } = await supabase
      .from("inventory_items")
      .select("*")
      .eq("user_id", user.id)
      .order("name", { ascending: true });

    if (error) {
      toast({ title: "Could not load inventory", description: error.message, variant: "destructive" });
    } else {
      setItems(data ?? []);
    }
    setIsLoading(false);
  }, [user, toast]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  /** Remember the chosen view so the page reopens the same way next time. */
  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Not critical if it can't be saved.
    }
  };

  // -------------------------------------------------------------------------
  // Form helpers
  // -------------------------------------------------------------------------

  /** Clear the form and close the add/edit dialog. */
  const resetForm = () => {
    setName("");
    setDescription("");
    setQuantityText("0");
    setThresholdText(String(DEFAULT_LOW_STOCK_THRESHOLD));
    setUnit("");
    setCategory("");
    setCondition("good");
    setLocation("");
    setNotes("");
    setEditingItem(null);
    setShowDialog(false);
  };

  /** Open the dialog with a clean form for a new item. */
  const openCreate = () => {
    resetForm();
    setShowDialog(true);
  };

  /** Open the dialog pre-filled with an existing item. */
  const openEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setName(item.name);
    setDescription(item.description ?? "");
    setQuantityText(String(getQty(item)));
    setThresholdText(String(getThreshold(item)));
    setUnit(item.unit ?? "");
    setCategory(item.category ?? "");
    setCondition(item.condition ?? "good");
    setLocation(item.location ?? "");
    setNotes(item.notes ?? "");
    setShowDialog(true);
  };

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  /**
   * Check a whole-number field. Returns an error message, or null if valid.
   * Quantities are whole numbers because the column is an integer; for
   * weights like "2.5 lbs", use a smaller unit such as ounces.
   */
  const validateWholeNumber = (text: string, fieldName: string): string | null => {
    if (text.trim() === "") return `Enter a ${fieldName}.`;
    const n = Number(text);
    if (!Number.isInteger(n) || n < 0) return `${fieldName[0].toUpperCase()}${fieldName.slice(1)} must be a whole number, 0 or more.`;
    if (n > MAX_QUANTITY) return `${fieldName[0].toUpperCase()}${fieldName.slice(1)} is too large.`;
    return null;
  };

  const quantityError = validateWholeNumber(quantityText, "quantity");
  const thresholdError = validateWholeNumber(thresholdText, "threshold");
  const isFormValid = name.trim() !== "" && !quantityError && !thresholdError;

  // -------------------------------------------------------------------------
  // Create / update
  // -------------------------------------------------------------------------

  /**
   * Insert a new item or update the one being edited.
   *
   * Fixes over the original:
   * - Trims all text fields before saving.
   * - Validates quantity and threshold.
   * - try/finally so the Saving state always clears, even if the request throws.
   * - Update is filtered by user_id as well as id.
   */
  const handleSave = async () => {
    if (!user || !isFormValid || isSaving) return;

    setIsSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        quantity: Number(quantityText),
        unit: unit.trim() || null,
        category: category.trim() || null,
        condition: condition as InventoryItem["condition"],
        location: location.trim() || null,
        notes: notes.trim() || null,
        low_stock_threshold: Number(thresholdText),
        user_id: user.id,
      };

      const { error } = editingItem
        ? await supabase.from("inventory_items").update(payload).eq("id", editingItem.id).eq("user_id", user.id)
        : await supabase.from("inventory_items").insert(payload);

      if (error) {
        toast({ title: "Could not save item", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: editingItem ? "Item updated" : "Item added" });
      resetForm();
      await loadItems();
    } catch (err) {
      toast({
        title: "Could not save item",
        description: err instanceof Error ? err.message : "Check your connection and try again.",
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
   * Delete the item held in pendingDelete.
   * The original deleted on a single click of the trash icon; it now goes
   * through a confirmation dialog first.
   */
  const confirmDelete = async () => {
    if (!user || !pendingDelete) return;

    setIsDeleting(true);
    try {
      const { error } = await supabase
        .from("inventory_items")
        .delete()
        .eq("id", pendingDelete.id)
        .eq("user_id", user.id);

      if (error) {
        toast({ title: "Could not delete item", description: error.message, variant: "destructive" });
        return;
      }

      toast({ title: "Item deleted" });
      setPendingDelete(null);
      await loadItems();
    } catch (err) {
      toast({
        title: "Could not delete item",
        description: err instanceof Error ? err.message : "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // -------------------------------------------------------------------------
  // Quick quantity adjust (+/- buttons)
  // -------------------------------------------------------------------------

  /**
   * Change an item's quantity by `delta` (+1 or -1).
   *
   * Fixes over the original:
   * - Optimistic: the number changes instantly, and is rolled back if the
   *   save fails, instead of waiting for the server on every click.
   * - Alerts only fire when stock DROPS across the threshold or hits zero.
   *   The original warned on every click while low, including when adding
   *   stock, which buried users in red toasts.
   * - Network failures (thrown errors) are caught and rolled back too.
   *
   * Note: this sets an absolute quantity, so two people adjusting the same
   * item at the same moment could overwrite each other. If that matters, move
   * this to a Postgres function that does `quantity = quantity + delta`.
   */
  const adjustQuantity = async (item: InventoryItem, delta: number) => {
    if (!user || updatingId) return;

    const oldQty = getQty(item);
    const newQty = Math.min(MAX_QUANTITY, Math.max(0, oldQty + delta));
    if (newQty === oldQty) return;

    const applyQty = (qty: number) =>
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, quantity: qty } : i)));

    setUpdatingId(item.id);
    applyQty(newQty); // Optimistic update.

    try {
      const { error } = await supabase
        .from("inventory_items")
        .update({ quantity: newQty })
        .eq("id", item.id)
        .eq("user_id", user.id);

      if (error) {
        applyQty(oldQty); // Roll back.
        toast({ title: "Could not update quantity", description: error.message, variant: "destructive" });
        return;
      }

      // Alerts on the way down only, and only when a line is crossed.
      if (delta < 0) {
        const threshold = getThreshold(item);
        if (newQty === 0) {
          toast({ title: "Out of stock", description: `${item.name} is now out of stock.`, variant: "destructive" });
        } else if (oldQty > threshold && newQty <= threshold) {
          toast({
            title: "Low stock",
            description: `${item.name} is running low: ${formatQty(newQty, item.unit)} left.`,
          });
        }
      }
    } catch (err) {
      applyQty(oldQty); // Roll back.
      toast({
        title: "Could not update quantity",
        description: err instanceof Error ? err.message : "Check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  };

  // -------------------------------------------------------------------------
  // Derived data (memoized)
  // -------------------------------------------------------------------------

  /** Items that need restocking, emptiest first, for the alert banner. */
  const restockItems = useMemo(
    () => items.filter(needsRestock).sort((a, b) => getQty(a) - getQty(b)),
    [items],
  );

  /** Items matching the search box and stock filter; used by all three views. */
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      const matchesSearch =
        !q ||
        [item.name, item.description, item.category, item.location, item.notes].some((field) =>
          field?.toLowerCase().includes(q),
        );
      const matchesStock =
        stockFilter === "all" ||
        (stockFilter === "out" && isOutOfStock(item)) ||
        (stockFilter === "low" && isLowStock(item)) ||
        (stockFilter === "in" && !needsRestock(item));
      return matchesSearch && matchesStock;
    });
  }, [items, searchQuery, stockFilter]);

  /**
   * Chart rows. Keeps the full name for the tooltip and a short label for the
   * axis. The original replaced the name, so the tooltip was truncated too.
   */
  const chartData = useMemo(
    () =>
      filteredItems.map((item) => ({
        id: item.id,
        fullName: item.name,
        label: item.name.length > MAX_AXIS_LABEL_LENGTH ? `${item.name.slice(0, MAX_AXIS_LABEL_LENGTH)}...` : item.name,
        quantity: getQty(item),
        unit: item.unit,
        low: needsRestock(item),
      })),
    [filteredItems],
  );

  /** Existing categories, offered as suggestions in the form. */
  const categorySuggestions = useMemo(
    () => Array.from(new Set(items.map((i) => i.category?.trim()).filter((c): c is string => Boolean(c)))).sort(),
    [items],
  );

  /** Existing locations, offered as suggestions in the form. */
  const locationSuggestions = useMemo(
    () => Array.from(new Set(items.map((i) => i.location?.trim()).filter((l): l is string => Boolean(l)))).sort(),
    [items],
  );

  /** Badge for an item's condition, falling back to the raw value if unknown. */
  const renderConditionBadge = (value: string) => {
    const opt = CONDITION_OPTIONS.find((o) => o.value === value);
    return <Badge variant={opt?.variant ?? "secondary"}>{opt?.label ?? value}</Badge>;
  };

  const isFiltering = searchQuery.trim() !== "" || stockFilter !== "all";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ===== Header: title, view switcher, add button ===== */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Inventory</h1>
          <p className="text-muted-foreground">Track donated supplies, equipment, and resources</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View switcher. aria-pressed tells screen readers which view is active. */}
          <div className="flex border rounded-md overflow-hidden" role="group" aria-label="Choose view">
            {VIEW_OPTIONS.map(({ value, label, icon: Icon }) => (
              <Button
                key={value}
                variant={viewMode === value ? "default" : "ghost"}
                size="icon"
                onClick={() => changeViewMode(value)}
                className="rounded-none"
                aria-label={label}
                aria-pressed={viewMode === value}
                title={label}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
              </Button>
            ))}
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add item
          </Button>
        </div>
      </div>

      {/* ===== Stock alerts banner =====
          Each badge is clickable and opens that item for editing, so restocking
          is one click away. */}
      {!isLoading && restockItems.length > 0 && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
            <h2 className="font-medium text-sm text-destructive">
              {restockItems.length} {restockItems.length === 1 ? "item needs" : "items need"} restocking
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {restockItems.map((item) => {
              const status = getStockStatus(item);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openEdit(item)}
                  className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Edit ${item.name}`}
                >
                  <Badge variant={status.variant} className={`text-xs cursor-pointer ${status.className ?? ""}`}>
                    {item.name}: {isOutOfStock(item) ? "out of stock" : `${formatQty(getQty(item), item.unit)} left`}
                  </Badge>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* ===== Search and stock filter (only once there are items) ===== */}
      {!isLoading && items.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search
              className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Search name, category, location, notes"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
              aria-label="Search inventory"
            />
          </div>
          <Select value={stockFilter} onValueChange={(v) => setStockFilter(v as StockFilter)}>
            <SelectTrigger className="w-[160px]" aria-label="Filter by stock status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All items</SelectItem>
              <SelectItem value="in">In stock</SelectItem>
              <SelectItem value="low">Low stock</SelectItem>
              <SelectItem value="out">Out of stock</SelectItem>
            </SelectContent>
          </Select>
          {isFiltering && (
            <p className="text-sm text-muted-foreground">
              Showing {filteredItems.length} of {items.length}
            </p>
          )}
        </div>
      )}

      {/* ===== Main content: loading, empty, no matches, or the chosen view ===== */}
      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-28 w-full" />
            </Card>
          ))}
        </div>
      ) : items.length === 0 ? (
        // Empty state: no items at all yet.
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Package className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No inventory items</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">
              Add items to track quantities and conditions.
            </p>
          </div>
          <Button onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Add first item
          </Button>
        </div>
      ) : filteredItems.length === 0 ? (
        // Items exist, but the search or filter hides all of them.
        <div className="text-center py-16 space-y-3">
          <p className="text-muted-foreground">No items match your search or filter.</p>
          <Button
            variant="outline"
            onClick={() => {
              setSearchQuery("");
              setStockFilter("all");
            }}
          >
            Clear filters
          </Button>
        </div>
      ) : (
        <>
          {/* ----- Grid view ----- */}
          {viewMode === "grid" && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item) => {
                const status = getStockStatus(item);
                const qty = getQty(item);
                const isLow = needsRestock(item);
                const isUpdating = updatingId === item.id;

                return (
                  <Card
                    key={item.id}
                    className={`p-5 hover-elevate flex flex-col ${isLow ? "border-destructive/50" : ""}`}
                  >
                    {/* Name, description and status */}
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate" title={item.name}>
                          {item.name}
                        </h3>
                        {item.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{item.description}</p>
                        )}
                      </div>
                      <Badge variant={status.variant} className={`shrink-0 ${status.className ?? ""}`}>
                        {status.label}
                      </Badge>
                    </div>

                    {/* Quantity with +/- buttons. aria-live announces the new number. */}
                    <div className="flex items-center justify-between gap-3 mb-3 p-3 rounded-md bg-muted/50">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => adjustQuantity(item, -1)}
                        disabled={qty === 0 || isUpdating}
                        aria-label={`Remove one ${item.name}`}
                      >
                        <Minus className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <div className="text-center" aria-live="polite">
                        <p className={`text-2xl font-bold ${isLow ? "text-destructive" : ""}`}>{qty}</p>
                        <p className="text-xs text-muted-foreground">{item.unit?.trim() || "units"}</p>
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => adjustQuantity(item, 1)}
                        disabled={isUpdating}
                        aria-label={`Add one ${item.name}`}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    </div>

                    {/* Stock level bar, relative to the item's own threshold (see getStockPercent). */}
                    <div
                      className="mb-3"
                      role="meter"
                      aria-label={`${item.name} stock level`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(getStockPercent(item))}
                    >
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isLow ? "bg-destructive" : "bg-chart-2"}`}
                          style={{ width: `${getStockPercent(item)}%` }}
                        />
                      </div>
                    </div>

                    {/* Category, location and condition. The location emoji is replaced with an icon. */}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-3">
                      {item.category && (
                        <span className="flex items-center gap-1">
                          <Tag className="h-3 w-3" aria-hidden="true" /> {item.category}
                        </span>
                      )}
                      {item.location && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" aria-hidden="true" />
                          <span className="sr-only">Location:</span> {item.location}
                        </span>
                      )}
                      {item.condition && renderConditionBadge(item.condition)}
                    </div>

                    {/* Actions, pinned to the bottom so cards line up */}
                    <div className="flex items-center gap-1 pt-3 border-t mt-auto">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPendingDelete(item)}
                        className="ml-auto"
                        aria-label={`Delete ${item.name}`}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ----- Table view ----- */}
          {viewMode === "table" && (
            <Card className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-center">Quantity</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead className="w-20">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredItems.map((item) => {
                    const status = getStockStatus(item);
                    const qty = getQty(item);
                    const isLow = needsRestock(item);
                    const isUpdating = updatingId === item.id;

                    return (
                      <TableRow key={item.id} className={isLow ? "bg-destructive/5" : ""}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell>
                          <Badge variant={status.variant} className={status.className}>
                            {status.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => adjustQuantity(item, -1)}
                              disabled={qty === 0 || isUpdating}
                              aria-label={`Remove one ${item.name}`}
                            >
                              <Minus className="h-3 w-3" aria-hidden="true" />
                            </Button>
                            {/* min-w instead of fixed w so 4+ digit quantities do not overflow. */}
                            <span
                              className={`font-bold min-w-8 px-1 text-center tabular-nums ${isLow ? "text-destructive" : ""}`}
                              aria-live="polite"
                            >
                              {qty}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-7 w-7"
                              onClick={() => adjustQuantity(item, 1)}
                              disabled={isUpdating}
                              aria-label={`Add one ${item.name}`}
                            >
                              <Plus className="h-3 w-3" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>{item.category ?? "-"}</TableCell>
                        <TableCell>{item.location ?? "-"}</TableCell>
                        <TableCell>{item.condition ? renderConditionBadge(item.condition) : "-"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEdit(item)}
                              aria-label={`Edit ${item.name}`}
                            >
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setPendingDelete(item)}
                              aria-label={`Delete ${item.name}`}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          {/* ----- Chart view ----- */}
          {viewMode === "chart" && (
            <Card className="p-6">
              <h2 className="font-semibold text-lg mb-6">Stock levels</h2>
              {/* Scrolls sideways when there are many items, so bars stay readable
                  instead of being squeezed until the labels overlap. */}
              <div className="overflow-x-auto">
                <div className="h-80" style={{ minWidth: Math.max(chartData.length * 48, 400) }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis
                        dataKey="label"
                        tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                        angle={-35}
                        textAnchor="end"
                        interval={0}
                      />
                      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} allowDecimals={false} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "6px",
                          color: "hsl(var(--foreground))",
                        }}
                        // Full item name as the title, quantity with its unit as the value.
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ""}
                        formatter={(value, _name, entry) => [
                          formatQty(Number(value), entry?.payload?.unit),
                          "Quantity",
                        ]}
                      />
                      <Bar dataKey="quantity" radius={[4, 4, 0, 0]}>
                        {/* Theme colors instead of a hard-coded blue, so the chart follows dark mode. */}
                        {chartData.map((entry) => (
                          <Cell key={entry.id} fill={entry.low ? "hsl(var(--destructive))" : "hsl(var(--primary))"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* Legend; colors match the Cell fills above. */}
              <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-primary" aria-hidden="true" /> In stock
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-3 w-3 rounded bg-destructive" aria-hidden="true" /> Low or out of stock
                </div>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ===== Add / edit dialog ===== */}
      <Dialog
        open={showDialog}
        onOpenChange={(open) => {
          // Block closing mid-save so the form is not wiped while a request is in flight.
          if (!open && !isSaving) resetForm();
        }}
      >
        {/* max-h + overflow so the long form scrolls on small screens. */}
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit item" : "Add inventory item"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Name (required) */}
            <div className="space-y-2">
              <Label htmlFor="item-name">Name</Label>
              <Input
                id="item-name"
                placeholder="Item name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={150}
                autoFocus
              />
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="item-description">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="item-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
              />
            </div>

            {/* Quantity and unit */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="item-quantity">Quantity</Label>
                <Input
                  id="item-quantity"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={quantityText}
                  onChange={(e) => setQuantityText(e.target.value)}
                  aria-invalid={Boolean(quantityError)}
                  aria-describedby={quantityError ? "item-quantity-error" : undefined}
                />
                {quantityError && (
                  <p id="item-quantity-error" className="text-xs text-destructive">
                    {quantityError}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-unit">Unit</Label>
                <Input
                  id="item-unit"
                  placeholder="boxes, lbs, units..."
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  maxLength={30}
                />
              </div>
            </div>

            {/* Category (with suggestions) and condition */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="item-category">Category</Label>
                <Input
                  id="item-category"
                  placeholder="Food, Clothing..."
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  list="inventory-category-suggestions"
                  maxLength={60}
                />
                <datalist id="inventory-category-suggestions">
                  {categorySuggestions.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-condition">Condition</Label>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger id="item-condition">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONDITION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Low-stock threshold */}
            <div className="space-y-2">
              <Label htmlFor="item-threshold">Low stock alert threshold</Label>
              <Input
                id="item-threshold"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={thresholdText}
                onChange={(e) => setThresholdText(e.target.value)}
                aria-invalid={Boolean(thresholdError)}
                aria-describedby="item-threshold-help"
              />
              <p id="item-threshold-help" className={`text-xs ${thresholdError ? "text-destructive" : "text-muted-foreground"}`}>
                {thresholdError ?? "Flag this item when the quantity drops to or below this number. Use 0 to turn alerts off."}
              </p>
            </div>

            {/* Location (with suggestions) */}
            <div className="space-y-2">
              <Label htmlFor="item-location">Location</Label>
              <Input
                id="item-location"
                placeholder="Storage room, Shelf A..."
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                list="inventory-location-suggestions"
                maxLength={100}
              />
              <datalist id="inventory-location-suggestions">
                {locationSuggestions.map((l) => (
                  <option key={l} value={l} />
                ))}
              </datalist>
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="item-notes">
                Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="item-notes"
                placeholder="Any additional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={1000}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={resetForm} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!isFormValid || isSaving}>
              {isSaving ? "Saving..." : editingItem ? "Save changes" : "Add item"}
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
            <DialogTitle>Delete this item?</DialogTitle>
            <DialogDescription>
              "{pendingDelete?.name}" ({pendingDelete ? formatQty(getQty(pendingDelete), pendingDelete.unit) : ""}) will
              be permanently removed from your inventory. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={isDeleting}>
              {isDeleting ? "Deleting..." : "Delete item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}