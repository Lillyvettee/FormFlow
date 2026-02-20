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
import { Plus, Package, Trash2, Pencil, LayoutGrid, List } from "lucide-react";
import type { InventoryItem } from "@/types/database";

const CONDITION_OPTIONS = [
  { value: "new", label: "New", variant: "default" as const },
  { value: "good", label: "Good", variant: "secondary" as const },
  { value: "fair", label: "Fair", variant: "secondary" as const },
  { value: "poor", label: "Poor", variant: "destructive" as const },
];

export default function InventoryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [unit, setUnit] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("good");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadItems = async () => {
    if (!user) return;
    setIsLoading(true);
    const { data } = await supabase.from("inventory_items").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setItems(data ?? []);
    setIsLoading(false);
  };

  useEffect(() => { loadItems(); }, [user]);

  const resetForm = () => {
    setName(""); setDescription(""); setQuantity(0); setUnit("");
    setCategory(""); setCondition("good"); setLocation(""); setNotes("");
    setEditingItem(null); setShowDialog(false);
  };

  const openEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setName(item.name); setDescription(item.description ?? "");
    setQuantity(item.quantity); setUnit(item.unit ?? "");
    setCategory(item.category ?? ""); setCondition(item.condition ?? "good");
    setLocation(item.location ?? ""); setNotes(item.notes ?? "");
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!user || !name.trim()) return;
    setIsSaving(true);
    const payload = { name, description: description || null, quantity, unit: unit || null, category: category || null, condition: condition as any, location: location || null, notes: notes || null, user_id: user.id };

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

  const getConditionBadge = (c: string) => {
    const opt = CONDITION_OPTIONS.find((o) => o.value === c);
    return <Badge variant={opt?.variant ?? "secondary"}>{opt?.label ?? c}</Badge>;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Inventory</h1>
          <p className="text-muted-foreground">Track donated supplies, equipment, and resources</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-md overflow-hidden">
            <Button variant={viewMode === "grid" ? "default" : "ghost"} size="icon" onClick={() => setViewMode("grid")} className="rounded-r-none">
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button variant={viewMode === "table" ? "default" : "ghost"} size="icon" onClick={() => setViewMode("table")} className="rounded-l-none">
              <List className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={() => setShowDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add Item
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => <Card key={i} className="p-5"><Skeleton className="h-28 w-full" /></Card>)}
        </div>
      ) : items.length > 0 ? (
        viewMode === "grid" ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <Card key={item.id} className="p-5 hover-elevate">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{item.name}</h3>
                    {item.description && <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{item.description}</p>}
                  </div>
                  {item.condition && getConditionBadge(item.condition)}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div>
                    <p className="text-muted-foreground text-xs">Quantity</p>
                    <p className="font-semibold">{item.quantity} {item.unit ?? ""}</p>
                  </div>
                  {item.category && (
                    <div>
                      <p className="text-muted-foreground text-xs">Category</p>
                      <p className="font-semibold">{item.category}</p>
                    </div>
                  )}
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
            ))}
          </div>
        ) : (
          <Card className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{item.condition ? getConditionBadge(item.condition) : "-"}</TableCell>
                    <TableCell className="text-right">{item.quantity} {item.unit ?? ""}</TableCell>
                    <TableCell>{item.category ?? "-"}</TableCell>
                    <TableCell>{item.location ?? "-"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(item)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )
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
