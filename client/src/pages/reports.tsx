import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Download, FileText, FileDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import type { Form, FormSubmission, FormField } from "@/types/database";

const CHART_COLORS = ["hsl(217, 91%, 35%)", "hsl(195, 80%, 32%)", "hsl(173, 58%, 30%)", "hsl(150, 45%, 28%)", "hsl(125, 40%, 26%)"];

export default function ReportsPage() {
  const { user } = useAuth();
  const [forms, setForms] = useState<Form[]>([]);
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<FormSubmission[]>([]);
  const [selectedFormId, setSelectedFormId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setIsLoading(true);
      const { data: formsData } = await supabase.from("forms").select("*").eq("user_id", user.id).eq("is_archived", false);
      setForms(formsData ?? []);
      if (formsData?.length) {
        const { data: subData } = await supabase.from("form_submissions").select("*").in("form_id", formsData.map(f => f.id));
        setAllSubmissions(subData ?? []);
      }
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

  const selectedForm = forms.find((f) => f.id === selectedFormId);
  const formFields = (selectedForm?.fields as FormField[]) ?? [];

  const getFieldSummary = (field: FormField) => {
    const values = submissions.map((s) => (s.data as Record<string, any>)?.[field.id]).filter((v) => v !== undefined && v !== null && v !== "");
    if (field.type === "number") {
      const nums = values.map(Number).filter((n) => !isNaN(n));
      if (!nums.length) return null;
      return { type: "number", count: nums.length, avg: (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1), min: Math.min(...nums), max: Math.max(...nums) };
    }
    if (field.type === "select" || field.type === "radio" || field.type === "checkbox") {
      const counts: Record<string, number> = {};
      values.forEach((v) => { const key = String(v); counts[key] = (counts[key] || 0) + 1; });
      return { type: "chart", data: Object.entries(counts).map(([name, value]) => ({ name, value })) };
    }
    return { type: "text", values: values.map(String).slice(0, 5) };
  };

  const submissionsByDate = () => {
    const byDate: Record<string, number> = {};
    submissions.forEach((s) => {
      const d = new Date(s.submitted_at).toLocaleDateString();
      byDate[d] = (byDate[d] || 0) + 1;
    });
    return Object.entries(byDate).slice(-14).map(([date, count]) => ({ date, count }));
  };

  const exportCSV = () => {
    if (!submissions.length || !formFields.length) return;
    const headers = ["Submitted At", ...formFields.map((f) => f.label)];
    const rows = submissions.map((s) => [
      new Date(s.submitted_at).toLocaleString(),
      ...formFields.map((f) => String((s.data as Record<string, any>)?.[f.id] ?? "")),
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${selectedForm?.title ?? "report"}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = async () => {
    setIsExportingPdf(true);
    try {
      const printContent = reportRef.current?.innerHTML ?? "";
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>${selectedForm?.title ?? "Report"} - FormFlow Report</title>
          <style>
            body { font-family: Georgia, serif; max-width: 900px; margin: 0 auto; padding: 40px; color: #111; }
            h1 { font-size: 28px; margin-bottom: 4px; }
            h2 { font-size: 18px; border-bottom: 1px solid #ddd; padding-bottom: 8px; margin-top: 32px; }
            h3 { font-size: 14px; color: #555; margin-top: 0; }
            table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
            th { background: #f5f5f5; text-align: left; padding: 8px 12px; border: 1px solid #ddd; }
            td { padding: 8px 12px; border: 1px solid #ddd; }
            tr:nth-child(even) td { background: #fafafa; }
            .stat { display: inline-block; background: #f5f5f5; border-radius: 8px; padding: 12px 20px; margin: 4px; text-align: center; }
            .stat strong { display: block; font-size: 24px; }
            .stat span { font-size: 12px; color: #666; }
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>
          <h1>${selectedForm?.title ?? "Report"}</h1>
          <h3>Generated by FormFlow · ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</h3>
          <div class="stat"><strong>${submissions.length}</strong><span>Total Submissions</span></div>
          <div class="stat"><strong>${formFields.length}</strong><span>Form Fields</span></div>
          <h2>All Submissions</h2>
          <table>
            <thead><tr><th>#</th>${formFields.map(f => `<th>${f.label}</th>`).join("")}<th>Submitted</th></tr></thead>
            <tbody>
              ${submissions.map((s, i) => `<tr><td>${i + 1}</td>${formFields.map(f => `<td>${(s.data as any)?.[f.id] ?? "-"}</td>`).join("")}<td>${new Date(s.submitted_at).toLocaleDateString()}</td></tr>`).join("")}
            </tbody>
          </table>
        </body>
        </html>
      `);
      w.document.close();
      setTimeout(() => { w.print(); }, 500);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const submissionsByForm = forms.map((f) => ({
    name: f.title.length > 15 ? f.title.slice(0, 15) + "..." : f.title,
    submissions: allSubmissions.filter((s) => s.form_id === f.id).length,
  }));

  const dateData = submissionsByDate();

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" ref={reportRef}>
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
              <SelectTrigger className="w-64"><SelectValue placeholder="Select a form to view report" /></SelectTrigger>
              <SelectContent>
                {forms.map((form) => <SelectItem key={form.id} value={form.id}>{form.title}</SelectItem>)}
              </SelectContent>
            </Select>
            {selectedFormId && <Badge variant="secondary">{submissions.length} submissions</Badge>}
          </div>
          {selectedFormId && submissions.length > 0 && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportCSV}>
                <Download className="mr-1 h-3.5 w-3.5" /> CSV
              </Button>
              <Button variant="outline" size="sm" onClick={exportPDF} disabled={isExportingPdf}>
                <FileDown className="mr-1 h-3.5 w-3.5" /> {isExportingPdf ? "Preparing..." : "PDF"}
              </Button>
            </div>
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
            {/* Summary stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: "Total Submissions", value: submissions.length },
                { label: "This Week", value: submissions.filter(s => new Date(s.submitted_at) > new Date(Date.now() - 7 * 86400000)).length },
                { label: "This Month", value: submissions.filter(s => new Date(s.submitted_at) > new Date(Date.now() - 30 * 86400000)).length },
                { label: "Form Fields", value: formFields.length },
              ].map((stat) => (
                <Card key={stat.label} className="p-4 text-center">
                  <p className="text-2xl font-bold">{stat.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{stat.label}</p>
                </Card>
              ))}
            </div>

            {/* Submissions over time */}
            {dateData.length > 1 && (
              <div>
                <h3 className="font-semibold mb-3">Submissions Over Time</h3>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={dateData}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                      <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} />
                      <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px" }} />
                      <Line type="monotone" dataKey="count" stroke="hsl(217, 91%, 35%)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* Field visualizations */}
            {formFields.filter(f => ["select","radio","checkbox"].includes(f.type)).length > 0 && (
              <div>
                <h3 className="font-semibold mb-3">Field Breakdowns</h3>
                <div className="grid sm:grid-cols-2 gap-6">
                  {formFields.filter(f => ["select","radio","checkbox"].includes(f.type)).map((field) => {
                    const summary = getFieldSummary(field);
                    if (!summary || summary.type !== "chart") return null;
                    const data = summary.data as { name: string; value: number }[];
                    return (
                      <div key={field.id} className="space-y-2">
                        <h4 className="text-sm font-medium">{field.label}</h4>
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                              <Pie data={data} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                              </Pie>
                              <Tooltip />
                            </PieChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Number fields */}
            {formFields.filter(f => f.type === "number").map((field) => {
              const summary = getFieldSummary(field);
              if (!summary || summary.type !== "number") return null;
              return (
                <div key={field.id}>
                  <h4 className="text-sm font-medium mb-2">{field.label} — Statistics</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {[["Average", summary.avg], ["Min", summary.min], ["Max", summary.max]].map(([label, val]) => (
                      <Card key={label as string} className="p-3 text-center">
                        <p className="text-xl font-bold">{val}</p>
                        <p className="text-xs text-muted-foreground">{label}</p>
                      </Card>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* All submissions table */}
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
