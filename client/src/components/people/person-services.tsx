/**
 * PersonServices
 *
 * The "Help given" section of a person's page (migration 012): each time the
 * person was given help (a food box, rent help, a referral...), with an
 * optional dollar value and an optional inventory item.
 *
 * Choosing an inventory item takes that many out of stock; deleting the entry
 * puts them back (the database does both, and refuses to go below zero). The
 * item and quantity can't be changed on an existing entry: delete it and add
 * it again instead, so stock always matches.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useOrganization } from "@/hooks/use-organization";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { friendlyWriteError } from "@/lib/db-errors";
import { formatCurrency, formatDate, toISODate } from "@/lib/report-utils";
import { HandHeart, Package, Pencil, Plus, Trash2 } from "lucide-react";

export interface Service {
  id: string;
  person_id: string;
  date: string;
  service_type: string;
  description: string | null;
  value: number | string | null;
  inventory_item_id: string | null;
  quantity: number | null;
  created_at: string;
}

interface StockItem {
  id: string;
  name: string;
  quantity: number;
  unit: string | null;
}

/** Suggested types until the organization has its own history. */
export const COMMON_SERVICE_TYPES = ["Food box", "Groceries", "Clothing", "Hygiene kit", "Rent help", "Utility help", "Transportation", "Referral", "Case management", "Meal"];

const NO_ITEM = "__none__";

function ServiceDialog({
  personId,
  personName,
  service,
  types,
  items,
  onClose,
  onSaved,
}: {
  personId: string;
  personName: string;
  service: Service | "new";
  types: string[];
  items: StockItem[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isNew = service === "new";
  const [date, setDate] = useState(isNew ? toISODate(new Date()) : service.date);
  const [type, setType] = useState(isNew ? "" : service.service_type);
  const [description, setDescription] = useState(isNew ? "" : service.description ?? "");
  const [value, setValue] = useState(isNew || service.value == null ? "" : String(service.value));
  const [itemId, setItemId] = useState(NO_ITEM);
  const [quantity, setQuantity] = useState("1");
  const [showErrors, setShowErrors] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const item = items.find((i) => i.id === itemId);
  const qty = Number(quantity);
  const amount = value.trim() ? Number(value.replace(/[$,]/g, "")) : null;
  const errors = {
    type: type.trim() ? null : "Choose or type what was given.",
    date: date ? null : "Choose a date.",
    value: amount === null || (Number.isFinite(amount) && amount >= 0) ? null : "Enter a dollar amount, or leave it blank.",
    quantity: !item ? null : !Number.isInteger(qty) || qty < 1 ? "Enter a whole number, 1 or more." : qty > item.quantity ? `Only ${item.quantity} in stock.` : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const save = async () => {
    setShowErrors(true);
    if (hasErrors || isSaving) return;
    setIsSaving(true);
    const row = {
      date,
      service_type: type.trim(),
      description: description.trim() || null,
      value: amount === null ? null : Math.round(amount * 100) / 100,
    };
    const { error } = isNew
      ? await supabase.from("services").insert({ ...row, person_id: personId, ...(item ? { inventory_item_id: item.id, quantity: qty } : {}) })
      : await supabase.from("services").update(row).eq("id", service.id);
    setIsSaving(false);
    if (error) {
      toast({ title: "Couldn't save", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    toast({ title: isNew ? "Help recorded" : "Saved", description: item ? `${qty} ${item.unit ?? ""} ${item.name} taken out of inventory.`.replace(/\s+/g, " ") : undefined });
    onSaved();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? `Record help for ${personName}` : "Edit help given"}</DialogTitle>
          <DialogDescription>What was given, when, and what it was worth.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="service-type">What was given</Label>
              <Input id="service-type" list="service-types" value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. Food box" maxLength={80} autoFocus aria-invalid={showErrors && Boolean(errors.type)} />
              <datalist id="service-types">
                {types.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {showErrors && errors.type && <p className="text-xs text-destructive">{errors.type}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="service-date">Date</Label>
              <Input id="service-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              {showErrors && errors.date && <p className="text-xs text-destructive">{errors.date}</p>}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="service-value">Value in dollars (optional)</Label>
            <Input id="service-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 40" aria-invalid={showErrors && Boolean(errors.value)} />
            {showErrors && errors.value ? (
              <p className="text-xs text-destructive">{errors.value}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Funders often ask for the value of help given. An estimate is fine.</p>
            )}
          </div>
          {isNew ? (
            items.length > 0 && (
              <div className="rounded-md border p-3 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="service-item" className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" aria-hidden="true" /> Take from inventory (optional)
                  </Label>
                  <Select value={itemId} onValueChange={setItemId}>
                    <SelectTrigger id="service-item">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ITEM}>Nothing from inventory</SelectItem>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id} disabled={i.quantity < 1}>
                          {i.name} ({i.quantity} {i.unit ?? "in stock"})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {item && (
                  <div className="space-y-1.5">
                    <Label htmlFor="service-qty">How many</Label>
                    <Input id="service-qty" type="number" min={1} max={item.quantity} value={quantity} onChange={(e) => setQuantity(e.target.value)} className="w-32" aria-invalid={showErrors && Boolean(errors.quantity)} />
                    {errors.quantity ? (
                      <p className="text-xs text-destructive">{errors.quantity}</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Leaves {item.quantity - qty} {item.unit ?? ""} in stock.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          ) : (
            service.inventory_item_id && (
              <p className="text-xs text-muted-foreground">
                The inventory item and quantity can't be changed here. To change them, delete this entry (stock goes back) and record it again.
              </p>
            )
          )}
          <div className="space-y-1.5">
            <Label htmlFor="service-description">Details (optional)</Label>
            <Textarea id="service-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={isSaving}>
            {isSaving ? "Saving..." : isNew ? "Record help" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PersonServices({ personId, personName }: { personId: string; personName: string }) {
  const { canEdit } = useOrganization();
  const { toast } = useToast();
  const [services, setServices] = useState<Service[]>([]);
  const [items, setItems] = useState<StockItem[]>([]);
  const [knownTypes, setKnownTypes] = useState<string[]>([]);
  const [itemNames, setItemNames] = useState<Map<string, string>>(new Map());
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [editing, setEditing] = useState<Service | "new" | null>(null);

  const load = useCallback(async () => {
    const [servicesRes, typesRes, itemsRes] = await Promise.all([
      supabase.from("services").select("*").eq("person_id", personId).order("date", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("services").select("service_type").order("created_at", { ascending: false }).limit(500),
      supabase.from("inventory_items").select("id, name, quantity, unit").eq("is_sample", false).order("name"),
    ]);
    if (servicesRes.error) {
      setState(["PGRST205", "42P01"].includes(servicesRes.error.code ?? "") ? "missing" : "ready");
      return;
    }
    setServices(servicesRes.data ?? []);
    setKnownTypes((typesRes.data ?? []).map((r: { service_type: string }) => r.service_type.trim()));
    const stock = (itemsRes.data ?? []).map((i: StockItem) => ({ ...i, quantity: Number(i.quantity) || 0 }));
    setItems(stock);
    setItemNames(new Map(stock.map((i) => [i.id, i.name])));
    setState("ready");
  }, [personId]);

  useEffect(() => {
    load();
  }, [load]);

  /** The organization's own types first (most used), then common ones. */
  const types = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of knownTypes) counts.set(t, (counts.get(t) ?? 0) + 1);
    const own = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
    return [...own, ...COMMON_SERVICE_TYPES.filter((t) => !own.some((o) => o.toLowerCase() === t.toLowerCase()))];
  }, [knownTypes]);

  const total = services.reduce((s, x) => s + (Number(x.value) || 0), 0);

  const remove = async (s: Service) => {
    const back = s.inventory_item_id && s.quantity ? ` ${s.quantity} ${itemNames.get(s.inventory_item_id) ?? "items"} will go back into inventory.` : "";
    if (!window.confirm(`Delete "${s.service_type}" on ${formatDate(s.date)}?${back}`)) return;
    const { error } = await supabase.from("services").delete().eq("id", s.id);
    if (error) {
      toast({ title: "Couldn't delete", description: friendlyWriteError(error), variant: "destructive" });
      return;
    }
    load();
  };

  if (state === "loading") return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold flex items-center gap-2">
          <HandHeart className="h-4 w-4 text-primary" aria-hidden="true" /> Help given ({services.length})
          {total > 0 && <span className="text-sm font-normal text-muted-foreground">· {formatCurrency(total)} total value</span>}
        </h2>
        {canEdit && state === "ready" && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Record help
          </Button>
        )}
      </div>
      {state === "missing" ? (
        <Card className="p-5 text-sm text-muted-foreground">
          Recording help needs a database update: run <code className="font-mono text-xs">012_services_and_case_notes.sql</code> in the Supabase SQL Editor.
        </Card>
      ) : services.length === 0 ? (
        <Card className="p-5 text-sm text-muted-foreground">Nothing recorded yet. Use Record help each time {personName.split(" ")[0]} receives a service or items.</Card>
      ) : (
        <Card className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Help given</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Details</TableHead>
                {canEdit && (
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {services.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="whitespace-nowrap">{formatDate(s.date)}</TableCell>
                  <TableCell>
                    <span className="font-medium">{s.service_type}</span>
                    {s.inventory_item_id && s.quantity ? (
                      <Badge variant="secondary" className="ml-2 text-[10px]">
                        {s.quantity} × {itemNames.get(s.inventory_item_id) ?? "item"}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right whitespace-nowrap">{s.value == null ? "-" : formatCurrency(Number(s.value))}</TableCell>
                  <TableCell className="max-w-[260px] truncate text-muted-foreground" title={s.description ?? undefined}>
                    {s.description || "-"}
                  </TableCell>
                  {canEdit && (
                    <TableCell className="text-right whitespace-nowrap">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(s)} aria-label={`Edit ${s.service_type} on ${formatDate(s.date)}`}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => remove(s)} aria-label={`Delete ${s.service_type} on ${formatDate(s.date)}`}>
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {editing && (
        <ServiceDialog personId={personId} personName={personName} service={editing} types={types} items={items} onClose={() => setEditing(null)} onSaved={load} />
      )}
    </div>
  );
}
