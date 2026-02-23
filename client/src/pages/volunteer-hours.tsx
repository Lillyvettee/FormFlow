import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Clock, Trash2, Pencil, Download, Users } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface VolunteerHour {
  id: string;
  volunteer_name: string;
  activity: string;
  hours: number;
  date: string;
  notes: string | null;
  created_at: string;
}

export default function VolunteerHoursPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [records, setRecords] = useState<VolunteerHour[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingRecord, setEditingRecord] = useState<VolunteerHour | null>(null);
  const [volunteerName, setVolunteerName] = useState("");
  const [activity, setActivity] = useState("");
  const [hours, setHours] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const loadRecords = async () => {
    if (!user) return;
    setIsLoading(true);
    const { data } = await supabase.from("volunteer_hours").select("*").eq("user_id", user.id).order("date", { ascending: false });
    setRecords(data ?? []);
    setIsLoading(false);
  };

  useEffect(() => { loadRecords(); }, [user]);

  const resetForm = () => {
    setVolunteerName(""); setActivity(""); setHours(""); setDate(new Date().toISOString().split("T")[0]); setNotes("");
    setEditingRecord(null); setShowDialog(false);
  };

  const openEdit = (r: VolunteerHour) => {
    setEditingRecord(r);
    setVolunteerName(r.volunteer_name); setActivity(r.activity);
    setHours(String(r.hours)); setDate(r.date); setNotes(r.notes ?? "");
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!user || !volunteerName.trim() || !activity.trim() || !hours) return;
    setIsSaving(true);
    const payload = {
      user_id: user.id,
      volunteer_name: volunteerName.trim(),
      activity: activity.trim(),
      hours: parseFloat(hours),
      date,
      notes: notes.trim() || null,
    };

    if (editingRecord) {
      const { error } = await supabase.from("volunteer_hours").update(payload).eq("id", editingRecord.id);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Record updated" }); resetForm(); loadRecords(); }
    } else {
      const { error } = await supabase.from("volunteer_hours").insert(payload);
      if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
      else { toast({ title: "Hours logged" }); resetForm(); loadRecords(); }
    }
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("volunteer_hours").delete().eq("id", id);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); }
    else { toast({ title: "Record deleted" }); loadRecords(); }
  };

  const exportCSV = () => {
    const headers = ["Volunteer", "Activity", "Hours", "Date", "Notes"];
    const rows = records.map(r => [r.volunteer_name, r.activity, r.hours, r.date, r.notes ?? ""]);
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "volunteer-hours.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const totalHours = records.reduce((s, r) => s + Number(r.hours), 0);
  const thisMonth = records.filter(r => new Date(r.date) > new Date(Date.now() - 30 * 86400000)).reduce((s, r) => s + Number(r.hours), 0);
  const uniqueVolunteers = new Set(records.map(r => r.volunteer_name)).size;

  // Top volunteers chart
  const byVolunteer = records.reduce((acc, r) => {
    acc[r.volunteer_name] = (acc[r.volunteer_name] ?? 0) + Number(r.hours);
    return acc;
  }, {} as Record<string, number>);
  const chartData = Object.entries(byVolunteer)
    .map(([name, hours]) => ({ name: name.length > 12 ? name.slice(0, 12) + "…" : name, hours }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10);

  // Unique names/activities for autocomplete
  const volunteerNames = Array.from(new Set(records.map(r => r.volunteer_name)));
  const activities = Array.from(new Set(records.map(r => r.activity)));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Volunteer Hours</h1>
          <p className="text-muted-foreground">Track volunteer time for grant applications and impact reports</p>
        </div>
        <div className="flex items-center gap-2">
          {records.length > 0 && (
            <Button variant="outline" onClick={exportCSV}>
              <Download className="mr-1 h-4 w-4" /> Export CSV
            </Button>
          )}
          <Button onClick={() => setShowDialog(true)}>
            <Plus className="mr-1 h-4 w-4" /> Log Hours
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: "Total Hours", value: totalHours.toLocaleString() },
          { label: "This Month", value: thisMonth.toLocaleString() },
          { label: "Volunteers", value: uniqueVolunteers },
          { label: "Entries", value: records.length },
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
          <h2 className="font-semibold mb-4 flex items-center gap-2"><Users className="h-4 w-4 text-primary" /> Top Volunteers by Hours</h2>
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                <Tooltip formatter={(v) => [`${v} hrs`, "Hours"]} contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }} />
                <Bar dataKey="hours" fill="hsl(217, 91%, 35%)" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Table */}
      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : records.length > 0 ? (
        <Card className="overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Volunteer</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Notes</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.volunteer_name}</TableCell>
                  <TableCell><Badge variant="secondary">{r.activity}</Badge></TableCell>
                  <TableCell className="text-right font-semibold text-primary">{r.hours}</TableCell>
                  <TableCell>{new Date(r.date + "T00:00:00").toLocaleDateString()}</TableCell>
                  <TableCell className="max-w-[150px] truncate text-muted-foreground">{r.notes ?? "-"}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(r.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
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
            <Clock className="h-7 w-7 text-muted-foreground" />
          </div>
          <div className="space-y-1.5">
            <h3 className="font-semibold text-lg">No hours logged yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mx-auto">Track volunteer time to strengthen grant applications and show your community impact.</p>
          </div>
          <Button onClick={() => setShowDialog(true)}><Plus className="mr-1 h-4 w-4" /> Log First Hours</Button>
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editingRecord ? "Edit Hours" : "Log Volunteer Hours"}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Volunteer Name</Label>
              <Input placeholder="Jane Smith" value={volunteerName} onChange={(e) => setVolunteerName(e.target.value)} list="volunteer-names" />
              {volunteerNames.length > 0 && <datalist id="volunteer-names">{volunteerNames.map(n => <option key={n} value={n} />)}</datalist>}
            </div>
            <div className="space-y-2">
              <Label>Activity</Label>
              <Input placeholder="Food distribution, Event setup..." value={activity} onChange={(e) => setActivity(e.target.value)} list="activities" />
              {activities.length > 0 && <datalist id="activities">{activities.map(a => <option key={a} value={a} />)}</datalist>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Hours</Label>
                <Input type="number" min="0.5" step="0.5" placeholder="2.5" value={hours} onChange={(e) => setHours(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Notes <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Textarea placeholder="Any additional notes..." value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetForm}>Cancel</Button>
            <Button onClick={handleSave} disabled={!volunteerName.trim() || !activity.trim() || !hours || isSaving}>
              {isSaving ? "Saving..." : editingRecord ? "Update" : "Log Hours"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
