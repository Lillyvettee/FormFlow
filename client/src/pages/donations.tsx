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
import { Plus, DollarSign, Trash2, Pencil, Download, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface Donation {
  id: string;
  donor_name: string;
  amount: number;
  date: string;
  campaign: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
}

const PAYMENT_METHODS = ["Cash", "Check", "Credit Card", "Bank Transfer", "PayPal", "Venmo", "Other"];

export default function DonationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [donations, setDonations] = useState<Donation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingDonation, setEditingDonation] = useState<Donation | null>(null);
  const [donorName, setDonorName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [campaign, setCampaign] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadDonations = async () => {
    if (!user) return;
    setIsLoading(true);
    const { data } = await supabase.from("donations").select("*").eq("user_id", user.id).order("date", { ascending: false });
    setDonations(data ?? []);
    setIsLoading(false);
  };

  useEffect(() => { loadDonations(); }, [user]);

  const resetForm = () => {
    setDonorName(""); setAmount(""); setDate(new Date().toISOString().split("T")[0]);
    setCampaign(""); setPaymentMethod(""); setNotes("");
    setEditingDonation(null); setShowDialog(false);
  };

  const openEdit = (d: Donation) => {
    setEditingDonation(d);
    setDonorName(d.donor_name); setAmount(String(d.amount)); setDate(d.date);
    setCampaign(d.campaign ?? ""); setPaymentMethod(d.payment_method ?? ""); setNotes(d.notes ?? "");
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!user || !donorName.trim() || !amount) return;
    setIsSaving(true);
    const payload = {
      user_id: user.id,
      donor_name: donorName.trim(),
      amount: parseFloat(amount),
      date,
      campaign: campaign.trim() || null,
      payment_method: paymentMethod || null,
      notes: notes.trim() || null,
    };

    if (editingDonation) {
      const { error } = await supabase.from("donations").update(payload).eq("id", editingDonation.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Donation updated" }); resetForm(); loadDonations(); }
    } else {
      const { error } = await supabase.from("donations").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Donation recorded" }); resetForm(); loadDonations(); }
    }
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("donations").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Donation deleted" }); loadDonations(); }
  };

  const exportCSV = () => {
    const headers = ["Donor", "Amount", "Date", "Campaign", "Payment Method", "Notes"];
    const rows = donations.map(d => [d.donor_name, d.amount, d.date, d.campaign ?? "", d.payment_method ?? "", d.notes ?? ""]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "donations.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const totalAmount = donations.reduce((s, d) => s + Number(d.amount), 0);
  const thisMonth = donations.filter(d => new Date(d.date) > new Date(Date.now() - 30 * 86400000)).reduce((s, d) => s + Number(d.amount), 0);

  // Chart data — donations by campaign
  const byCampaign = donations.reduce((acc, d) => {
    const key = d.campaign ?? "General";
    acc[key] = (acc[key] ?? 0) + Number(d.amount);
    return acc;
  }, {} as Record<string, number>);
  const chartData = Object.entries(byCampaign).map(([name, total]) => ({ name: name.length > 14 ? name.slice(0, 14) + "…" : name, total })).sort((a, b) => b.total - a.total);

  // Unique campaigns for autocomplete
  const campaigns = Array.from(new Set(donations.map(d => d.campaign).filter(Boolean) as string[]));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Donation Log</h1>
          <p className="text-muted-foreground">Track donations by donor, campaign, and payment method</p>
        </div>
        <div className="flex items-center gap-2">
          {donations.length > 0 && (
            <Button variant="outline" onClick={exportCSV}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
          )}
          <Button onClick={() => setShowDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> Record Donation
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Raised", value: `$${totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })}` },
          { label: "This Month", value: `$${thisMonth.toLocaleString("en-US", { minimumFractionDigits: 2 })}` },
          { label: "Total Donors", value: new Set(donations.map(d => d.donor_name)).size },
          { label: "Total Donations", value: donations.length },
        ].map((stat) => (
          <Card key={stat.label} className="p-4 text-center">
            <p className="text-xl font-bold text-primary">{stat.value}</p>
            <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
          </Card>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 0 && (
        <Card className="p-6">
          <h2 className="font-semibold mb-4 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" /> Donations by Campaign</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} tickFormatter={(v) => `$${v}`} />
                <Tooltip formatter={(v) => [`$${Number(v).toLocaleString()}`, "Total"]} contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }} />
                <Bar dataKey="total" radius={[4, 4, 0, 0]} fill="hsl(217, 91%, 35%)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : donations.length > 0 ? (
        <Card className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Donor</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {donations.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.donor_name}</TableCell>
                  <TableCell className="text-right font-semibold text-primary">${Number(d.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</TableCell>
                  <TableCell>{new Date(d.date + "T00:00:00").toLocaleDateString()}</TableCell>
                  <TableCell>{d.campaign ? <Badge variant="secondary">{d.campaign}</Badge> : "-"}</TableCell>
                  <TableCell>{d.payment_method ?? "-"}</TableCell>
                  <TableCell className="max-w-[150px] truncate text-muted-foreground">{d.notes ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(d)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(d.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <div className="text-center py-20 space-y-4">
          <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mx-auto">
            <DollarSign className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No donations recorded</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Start tracking donations to generate reports for your board and grant applications.</p>
          </div>
          <Button onClick={() => setShowDialog(true)}><Plus className="mr-1 h-4 w-4" /> Record First Donation</Button>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingDonation ? "Edit Donation" : "Record Donation"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2 col-span-2">
                <Label>Donor Name</Label>
                <Input placeholder="Jane Smith" value={donorName} onChange={(e) => setDonorName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Amount ($)</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Campaign <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input placeholder="Annual Fund, Summer Drive..." value={campaign} onChange={(e) => setCampaign(e.target.value)} list="campaign-suggestions" />
              {campaigns.length > 0 && <datalist id="campaign-suggestions">{campaigns.map(c => <option key={c} value={c} />)}</datalist>}
            </div>
            <div className="space-y-2">
              <Label>Payment Method <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger><SelectValue placeholder="Select method..." /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea placeholder="Any additional notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button onClick={handleSave} disabled={!donorName.trim() || !amount || isSaving}>
              {isSaving ? "Saving..." : editingDonation ? "Update" : "Record Donation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
