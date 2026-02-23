import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Download, FileText } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import type { Form, FormSubmission, FormField } from "@/types/database";

const CHART_COLORS = [
  "hsl(217, 91%, 35%)", "hsl(195, 80%, 32%)", "hsl(173, 58%, 30%)",
  "hsl(150, 45%, 28%)", "hsl(125, 40%, 26%)",
];

export default function ReportsPage() {
  const { user } = useAuth();
  const [forms, setForms] = useState<Form[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<FormSubmission[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setIsLoading(true);
      const { data: formsData } = await supabase.from("forms").select("*").eq("user_id", user.id).eq("is_archived", false);
      setForms(formsData ?? []);
      setIsLoading(false);
    };
    load();
  }, [user]);

  useEffect(() => {
    if (!selectedFormId) return;
    const load = async () => {
      const { data } = await supabase.from("form_submissions").select("*").eq("form_id", selectedFormId).order("submitted_at", { ascending: false });
      setSubmissions(data ?? []);
    };
    load();
  }, [selectedFormId]);

  useEffect(() => {
    if (!user || forms.length === 0) return;
    const load = async () => {
      const formIds = forms.map(f => f.id);
      const { data } = await supabase.from("form_submissions").select("*").in("form_id", formIds);
      setAllSubmissions(data ?? []);
    };
    load();
  }, [forms, user]);

  const selectedForm = forms.find((f) => f.id === selectedFormId);
  const formFields = (selectedForm?.fields as FormField[]) ?? [];

  const getFieldSummary = (field: FormField) => {
    const values = submissions.map((s) => (s.data as Record<string, any>)?.[field.id]).filter(Boolean);
    if (field.type === "number") {
      const nums = values.map(Number).filter((n) => !isNaN(n));
      return { count: nums.length, avg: nums.length ? (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1) : "0", min: nums.length ? Math.min(...nums) : 0, max: nums.length ? Math.max(...nums) : 0 };
    }
    if (field.type === "select" || field.type === "radio") {
      const counts: Record<string, number> = {};
      values.forEach((v) => { counts[String(v)] = (counts[String(v)] || 0) + 1; });
      return Object.entries(counts).map(([name, value]) => ({ name, value }));
    }
    if (field.type === "checkbox") {
      const trueCount = values.filter((v) => v === true || v === "true").length;
      return [{ name: "Yes", value: trueCount }, { name: "No", value: values.length - trueCount }];
    }
    return null;
  };

  const exportCSV = () => {
    if (!submissions.length || !formFields.length) return;
    const headers = formFields.map((f) => f.label);
    const rows = submissions.map((s) => formFields.map((f) => { const val = (s.data as Record<string, any>)?.[f.id]; return val !== undefined ? String(val) : ""; }));
    const csv = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${selectedForm?.title ?? "report"}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const submissionsByForm = forms.map((f) => ({
    name: f.title.length > 15 ? f.title.slice(0, 15) + "..." : f.title,
    submissions: allSubmissions.filter((s) => s.form_id === f.id).length,
  }));

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold">Reports</h1>
        <p className="text-muted-foreground">Generate impact reports for your board, donors, and grant applications</p>
      </div>

      {!selectedFormId && (
        <Card className="p-6">
          <h2 className="font-semibold text-lg mb-4">Submissions Overview</h2>
          {isLoading ? <Skeleton className="h-64 w-full" /> : submissionsByForm.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={submissionsByForm}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px", color: "hsl(var(--foreground))" }} />
                  <Bar dataKey="submissions" fill="hsl(217, 91%, 35%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="text-center py-12 text-sm text-muted-foreground">No submission data available yet</div>
          )}
        </Card>
      )}

      <Card className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <Select value={selectedFormId} onValueChange={setSelectedFormId}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select a form to view report" />
              </SelectTrigger>
              <SelectContent>
                {forms.map((form) => <SelectItem key={form.id} value={form.id}>{form.title}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedFormId && <Badge variant="secondary">{submissions.length} submissions</Badge>}
          </div>
          {selectedFormId && submissions.length > 0 && (
            <Button variant="outline" size="sm" onClick={exportCSV}>
              <Download className="mr-1 h-3.5 w-3.5" /> Export CSV
            </Button>
          )}
        </div>

        {!selectedFormId ? (
          <div className="text-center py-16 space-y-3">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto">
              <BarChart3 className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Select a form above to view its report</p>
          </div>
        ) : isLoading ? <Skeleton className="h-64 w-full" /> : submissions.length === 0 ? (
          <div className="text-center py-16 space-y-3">
            <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto">
              <FileText className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No submissions for this form yet</p>
          </div>
        ) : (
          <div className="space-y-8">
            {formFields.some((f) => f.type === "select" || f.type === "checkbox") && (
              <div className="grid sm:grid-cols-2 gap-6">
                {formFields.filter((f) => f.type === "select" || f.type === "checkbox").map((field) => {
                  const data = getFieldSummary(field) as { name: string; value: number }[];
                  return (
                    <div key={field.id} className="space-y-2">
                      <h3 className="text-sm font-medium">{field.label}</h3>
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie data={data} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                              {data?.map((_, index) => <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div>
              <h3 className="font-semibold mb-3">All Submissions</h3>
              <div className="border rounded-md overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      {formFields.map((f) => <TableHead key={f.id}>{f.label}</TableHead>)}
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {submissions.map((sub, index) => (
                      <TableRow key={sub.id}>
                        <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                        {formFields.map((f) => <TableCell key={f.id}>{String((sub.data as Record<string, any>)?.[f.id] ?? "-")}</TableCell>)}
                        <TableCell className="text-muted-foreground text-xs">{sub.submitted_at ? new Date(sub.submitted_at).toLocaleDateString() : "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
