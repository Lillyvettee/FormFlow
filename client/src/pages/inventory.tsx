import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isUnauthorizedError } from "@/lib/auth-utils";
import { Plus, Package, Trash2, Pencil, ExternalLink, LayoutGrid, List } from "lucide-react";
import type { InventoryItem } from "@shared/schema";

const STATUS_OPTIONS = [
  { value: "in_stock", label: "In Stock", variant: "default" as const },
  { value: "low_stock", label: "Low Stock", variant: "secondary" as const },
  { value: "out_of_stock", label: "Out of Stock", variant: "destructive" as const },
  { value: "ordered", label: "Ordered", variant: "secondary" as const },
];

export default function InventoryPage() {
  const { toast } = useToast();
  const { data: items, isLoading } = useQuery<InventoryItem[]>({ queryKey: ["/api/inventory"] });
  const [showDialog, setShowDialog] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [price, setPrice] = useState(0);
  const [supplierLink, setSupplierLink] = useState("");
  const [status, setStatus] = useState("in_stock");

  const resetForm = () => {
    setName("");
    setDescription("");
    setQuantity(0);
    setPrice(0);
    setSupplierLink("");
    setStatus("in_stock");
    setEditingItem(null);
    setShowDialog(false);
  };

  const openEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setName(item.name);
    setDescription(item.description || "");
    setQuantity(item.quantity);
    setPrice(item.price || 0);
    setSupplierLink(item.supplierLink || "");
    setStatus(item.status || "in_stock");
    setShowDialog(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const data = { name, description: description || null, quantity, price, supplierLink: supplierLink || null, status };
      if (editingItem) {
        return apiRequest("PATCH", `/api/inventory/${editingItem.id}`, data);
      }
      return apiRequest("POST", "/api/inventory", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: editingItem ? "Item updated" : "Item added" });
      resetForm();
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/inventory/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/inventory"] });
      toast({ title: "Item deleted" });
    },
    onError: (error: Error) => {
      if (isUnauthorizedError(error)) {
        toast({ title: "Unauthorized", description: "Logging in again...", variant: "destructive" });
        setTimeout(() => { window.location.href = "/login"; }, 500);
        return;
      }
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const getStatusBadge = (s: string) => {
    const opt = STATUS_OPTIONS.find((o) => o.value === s);
    return <Badge variant={opt?.variant || "secondary"}>{opt?.label || s}</Badge>;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold" data-testid="text-inventory-title">Inventory</h1>
          <p className="text-muted-foreground">Track donated supplies, equipment, and resources</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex border rounded-md overflow-visible">
            <Button
              variant={viewMode === "grid" ? "default" : "ghost"}
              size="icon"
              onClick={() => setViewMode("grid")}
              className="rounded-r-none"
              data-testid="button-view-grid"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === "table" ? "default" : "ghost"}
              size="icon"
              onClick={() => setViewMode("table")}
              className="rounded-l-none"
              data-testid="button-view-table"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
          <Button onClick={() => setShowDialog(true)} data-testid="button-add-item">
            <Plus className="mr-1 h-4 w-4" />
            Add Item
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="p-5"><Skeleton className="h-28 w-full" /></Card>
          ))}
        </div>
      ) : items && items.length > 0 ? (
        viewMode === "grid" ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((item) => (
              <Card key={item.id} className="p-5 hover-elevate" data-testid={`card-item-${item.id}`}>
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate" data-testid={`text-item-name-${item.id}`}>{item.name}</h3>
                    {item.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">{item.description}</p>
                    )}
                  </div>
                  {getStatusBadge(item.status || "in_stock")}
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                  <div>
                    <p className="text-muted-foreground text-xs">Quantity</p>
                    <p className="font-semibold" data-testid={`text-item-qty-${item.id}`}>{item.quantity}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Price</p>
                    <p className="font-semibold">${(item.price || 0).toFixed(2)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 pt-3 border-t">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(item)} data-testid={`button-edit-item-${item.id}`}>
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  {item.supplierLink && (
                    <a href={item.supplierLink} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="sm">
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                        Supplier
                      </Button>
                    </a>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(item.id)} className="ml-auto" data-testid={`button-delete-item-${item.id}`}>
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
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">{item.name}</TableCell>
                    <TableCell>{getStatusBadge(item.status || "in_stock")}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">${(item.price || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      {item.supplierLink ? (
                        <a href={item.supplierLink} target="_blank" rel="noopener noreferrer" className="text-primary text-xs hover:underline">
                          View
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(item)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => deleteMutation.mutate(item.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
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
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Add items to track quantities, prices, and supplier information.</p>
          </div>
          <Button onClick={() => setShowDialog(true)} data-testid="button-add-first-item">
            <Plus className="mr-1 h-4 w-4" />
            Add First Item
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
              <Label htmlFor="item-name">Name</Label>
              <Input id="item-name" placeholder="Item name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-item-name" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-desc">Description</Label>
              <Textarea id="item-desc" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} data-testid="input-item-description" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="item-qty">Quantity</Label>
                <Input id="item-qty" type="number" min={0} value={quantity} onChange={(e) => setQuantity(parseInt(e.target.value) || 0)} data-testid="input-item-quantity" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="item-price">Price ($)</Label>
                <Input id="item-price" type="number" min={0} step={0.01} value={price} onChange={(e) => setPrice(parseFloat(e.target.value) || 0)} data-testid="input-item-price" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-item-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-supplier">Supplier Link</Label>
              <Input id="item-supplier" placeholder="https://..." value={supplierLink} onChange={(e) => setSupplierLink(e.target.value)} data-testid="input-item-supplier" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!name.trim() || saveMutation.isPending}
              data-testid="button-save-item"
            >
              {saveMutation.isPending ? "Saving..." : editingItem ? "Update" : "Add Item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
