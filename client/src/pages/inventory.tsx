import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Package, Trash2, Pencil, LayoutGrid, List, Minus, AlertTriangle, BarChart3 } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { InventoryItem } from "@/types/database";

const CONDITION_OPTIONS = [
  { value: "new", label: "New", variant: "default" as const },
  { value: "good", label: "Good", variant: "secondary" as const },
  { value: "fair", label: "Fair", variant: "secondary" as const },
  { value: "poor", label: "Poor", variant: "destructive" as const },
];



function isLowStock(item: InventoryItem) {
  const threshold = (item as any).low_stock_threshold ?? 5;
  return item.quantity <= threshold && item.quantity > 0;
}

function isOutOfStock(item: InventoryItem) {
  return item.quantity === 0;
}

function getStockStatus(item: InventoryItem) {
  if (isOutOfStock(item)) return { label: "Out of Stock", variant: "destructive" as const };
  if (isLowStock(item)) return { label: "Low Stock", variant: "destructive" as const };
  return { label: "In Stock", variant: "default" as const };
}

export default function InventoryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table" | "chart">("grid");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("good");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [lowStockThreshold, setLowStockThreshold] = useState(5);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadItems = async () => {
    if (!user) return;
    setIsLoading(true);
    const { data } = await supabase.from("inventory_items").select("*").eq("user_id", user.id).order("name", { ascending: true });
    setItems(data ?? []);
    setIsLoading(false);
  };

  useEffect(() => { loadItems(); }, [user]);

  const resetForm = () => {
    setName(""); setDescription(""); setQuantity(0); setLowStockThreshold(5);
    setUnit(""); setCategory(""); setCondition("good"); setLocation(""); setNotes("");
    setEditingItem(null); setShowDialog(false);
  };

  const openEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setName(item.name); setDescription(item.description ?? "");
    setQuantity(item.quantity); setUnit(item.unit ?? "");
    setCategory(item.category ?? ""); setCondition(item.condition ?? "good");
    setLocation(item.location ?? ""); setNotes(item.notes ?? ""); setLowStockThreshold((item as any).low_stock_threshold ?? 5);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!user || !name.trim()) return;
    setIsSaving(true);
    const payload = {
      name, description: description || null, quantity,
      unit: unit || null, category: category || null,
      condition: condition as any, location: location || null,
      notes: notes || null, low_stock_threshold: lowStockThreshold, user_id: user.id,
    };
    if (editingItem) {
      const { error } = await supabase.from("inventory_items").update(payload).eq("id", editingItem.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Item updated" }); resetForm(); loadItems(); }
    } else {
      const { error } = await supabase.from("inventory_items").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Item added" }); resetForm(); loadItems(); }
    }
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("inventory_items").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Item deleted" }); loadItems(); }
  };

  const adjustQuantity = async (item: InventoryItem, delta: number) => {
    const newQty = Math.max(0, item.quantity + delta);
    setUpdatingId(item.id);
    const { error } = await supabase.from("inventory_items").update({ quantity: newQty }).eq("id", item.id);
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, quantity: newQty } : i));
      if (newQty === 0) {
        toast({ title: "Out of Stock", description: `${item.name} is now out of stock!`, variant: "destructive" });
      } else if (newQty <= ((item as any).low_stock_threshold ?? 5)) {
        toast({ title: "Low Stock Warning", description: `${item.name} is running low (${newQty} ${item.unit ?? "left"})`, variant: "destructive" });
      }
    }
    setUpdatingId(null);
  };

  const getConditionBadge = (c: string) => {
    const opt = CONDITION_OPTIONS.find((o) => o.value === c);
    return <Badge variant={opt?.variant ?? "secondary"}>{opt?.label ?? c}</Badge>;
  };

  const lowStockItems = items.filter((i) => isLowStock(i) || isOutOfStock(i));
  const chartData = items.map((item) => ({
    name: item.name.length > 12 ? item.name.slice(0, 12) + "..." : item.name,
    quantity: item.quantity,
    low: isLowStock(item) || isOutOfStock(item),
  }));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Inventory</h1>
          <p className="text-muted-foreground">Track donated supplies, equipment, and resources</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-md overflow-hidden">
            <Button variant={viewMode === "grid" ? "default" : "ghost"} size="icon" onClick={() => setViewMode("grid")} className="rounded-none">
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "table" ? "default" : "ghost"} size="icon" onClick={() => setViewMode("table")} className="rounded-none">
              <List className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "chart" ? "default" : "ghost"} size="icon" onClick={() => setViewMode("chart")} className="rounded-none">
              <BarChart3 className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={() => setShowDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add Item
          </Button>
        </div>
      </div>

      {lowStockItems.length > 0 && (
        <Card className="p-4 border-destructive/50 bg-destructive/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="font-medium text-sm text-destructive">Stock Alerts</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {lowStockItems.map((item) => (
              <Badge key={item.id} variant="destructive" className="text-xs">
                {item.name}: {item.quantity === 0 ? "Out of stock" : `${item.quantity} ${item.unit ?? ""} left`}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Card key={i} className="p-5"><Skeleton className="h-28 w-full" /></Card>)}
        </div>
      ) : items.length > 0 ? (
        <>
          {viewMode === "grid" && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((item) => {
                const status = getStockStatus(item);
                const isLow = isLowStock(item) || isOutOfStock(item);
                return (
                  <Card key={item.id} className={`p-5 hover-elevate ${isLow ? "border-destructive/50" : ""}`}>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold truncate">{item.name}</h3>
                        {item.description && <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{item.description}</p>}
                      </div>
                      <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
                    </div>

                    <div className="flex items-center justify-between gap-3 mb-3 p-3 rounded-md bg-muted/50">
                      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => adjustQuantity(item, -1)} disabled={item.quantity === 0 || updatingId === item.id}>
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <div className="text-center">
                        <p className={`text-2xl font-bold ${isLow ? "text-destructive" : ""}`}>{item.quantity}</p>
                        <p className="text-xs text-muted-foreground">{item.unit ?? "units"}</p>
                      </div>
                      <Button variant="outline" size="icon" className="h-8 w-8 shrink-0" onClick={() => adjustQuantity(item, 1)} disabled={updatingId === item.id}>
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="mb-3">
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${isLow ? "bg-destructive" : "bg-chart-2"}`}
                          style={{ width: `${isOutOfStock(item) ? 0 : Math.min(100, (item.quantity / Math.max(item.quantity, 20)) * 100)}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                      {item.category && <span>{item.category}</span>}
                      {item.location && <span>📍 {item.location}</span>}
                    </div>

                    <div className="flex items-center gap-1 pt-3 border-t">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                        <Pencil className="mr-1 h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(item.id)} className="ml-auto">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

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
                  {items.map((item) => {
                    const status = getStockStatus(item);
                    const isLow = isLowStock(item) || isOutOfStock(item);
                    return (
                      <TableRow key={item.id} className={isLow ? "bg-destructive/5" : ""}>
                        <TableCell className="font-medium">{item.name}</TableCell>
                        <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-2">
                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => adjustQuantity(item, -1)} disabled={item.quantity === 0 || updatingId === item.id}>
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className={`font-bold w-8 text-center ${isLow ? "text-destructive" : ""}`}>{item.quantity}</span>
                            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => adjustQuantity(item, 1)} disabled={updatingId === item.id}>
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell>{item.category ?? "-"}</TableCell>
                        <TableCell>{item.location ?? "-"}</TableCell>
                        <TableCell>{item.condition ? getConditionBadge(item.condition) : "-"}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}

          {viewMode === "chart" && (
            <Card className="p-6">
              <h2 className="font-semibold text-lg mb-6">Stock Levels</h2>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} angle={-35} textAnchor="end" interval={0} />
                    <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px", color: "hsl(var(--foreground))" }} formatter={(value) => [value, "Quantity"]} />
                    <Bar dataKey="quantity" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={index} fill={entry.low ? "hsl(var(--destructive))" : "hsl(217, 91%, 35%)"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded bg-[hsl(217,91%,35%)]" /> In Stock</div>
                <div className="flex items-center gap-1.5"><div className="h-3 w-3 rounded bg-destructive" /> Low / Out of Stock</div>
              </div>
            </Card>
          )}
        </>
      ) : (
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <Package className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No inventory items</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Add items to track quantities and conditions.</p>
          </div>
          <Button onClick={() => setShowDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add First Item
          </Button>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? "Edit Item" : "Add Inventory Item"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantity</Label>
                <Input type="number" min={0} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 0)} />
              </div>
              <div className="space-y-2">
                <Label>Unit</Label>
                <Input placeholder="boxes, lbs, units..." value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Category</Label>
                <Input placeholder="Food, Clothing..." value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Condition</Label>
                <Select value={condition} onValueChange={setCondition}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CONDITION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Low Stock Alert Threshold</Label>
              <Input type="number" min={0} value={lowStockThreshold} onChange={(e) => setLowStockThreshold(parseInt(e.target.value) || 0)} />
              <p className="text-xs text-muted-foreground -mt-2">Show red alert when quantity drops to or below this number</p>
            </div>
            <div className="space-y-2">
              <Label>Location</Label>
              <Input placeholder="Storage room, Shelf A..." value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea placeholder="Any additional notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button onClick={handleSave} disabled={!name.trim() || isSaving}>
              {isSaving ? "Saving..." : editingItem ? "Update" : "Add Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
