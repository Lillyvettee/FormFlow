import { useState, useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import {
  BarChart3,
  Download,
  FileText,
  FileDown,
  DollarSign,
  Clock,
  Package,
  TrendingUp,
  AlertTriangle,
  Search,
  X,
  CalendarRange,
} from "lucide-react";

// supabase import
import { supabase } from "@/lib/supabase";

// useAuth import
import { useAuth } from "@/hooks/use-auth";

// types
import type { Form, FormField, FormSubmission } from "@/types/database";

const COLORS = [
  "hsl(217, 91%, 35%)",
  "hsl(195, 80%, 32%)",
  "hsl(150, 58%, 30%)",
  "hsl(340, 70%, 45%)",
  "hsl(40, 85%, 40%)",
  "hsl(270, 60%, 40%)",
];

const REPORT_TYPES = [
  { value: "impact", label: "Impact Overview", icon: TrendingUp },
  { value: "donations", label: "Donation Report", icon: DollarSign },
  { value: "volunteers", label: "Volunteer Hours Report", icon: Clock },
  { value: "inventory", label: "Inventory Report", icon: Package },
  { value: "forms", label: "Form Submissions Report", icon: FileText },
];

const tooltipStyle = {
  backgroundColor: "hsl(var(--popover))",
  border: "1px solid hsl(var(--border))",
  borderRadius: "6px",
  color: "hsl(var(--foreground))",
};

export default function ReportsPage() {
  const { user } = useAuth();
  const [reportType, setReportType] = useState("impact");
  const [forms, setForms] = useState<Form[]>([]);
  const [selectedFormId, setSelectedFormId] = useState("");
  const [submissions, setSubmissions] = useState<FormSubmission[]>([]);
  const [donations, setDonations] = useState<any[]>([]);
  const [volunteerHours, setVolunteerHours] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [allSubmissions, setAllSubmissions] = useState<FormSubmission[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const filteredSubmissions = useMemo(() => {
    let result = submissions;
    if (dateFrom) {
      const from = new Date(dateFrom);
      from.setHours(0, 0, 0, 0);
      result = result.filter(
        (s) => s.submitted_at && new Date(s.submitted_at) >= from,
      );
    }
    if (dateTo) {
      const to = new Date(dateTo);
      to.setHours(23, 59, 59, 999);
      result = result.filter(
        (s) => s.submitted_at && new Date(s.submitted_at) <= to,
      );
    }
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((s) => {
        const data = s.data as Record<string, any>;
        return Object.values(data ?? {}).some((val) =>
          String(val ?? "")
            .toLowerCase()
            .includes(q),
        );
      });
    }
    return result;
  }, [submissions, searchQuery, dateFrom, dateTo]);

  const hasActiveFilters = searchQuery || dateFrom || dateTo;
  const clearFilters = () => {
    setSearchQuery("");
    setDateFrom("");
    setDateTo("");
  };

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setIsLoading(true);
      const [formsRes, donationsRes, volunteerRes, inventoryRes] =
        await Promise.all([
          supabase
            .from("forms")
            .select("*")
            .eq("user_id", user.id)
            .eq("is_archived", false),
          supabase
            .from("donations")
            .select("*")
            .eq("user_id", user.id)
            .order("date", { ascending: true }),
          supabase
            .from("volunteer_hours")
            .select("*")
            .eq("user_id", user.id)
            .order("date", { ascending: true }),
          supabase.from("inventory_items").select("*").eq("user_id", user.id),
        ]);
      const formList = formsRes.data ?? [];
      setForms(formList);
      setDonations(donationsRes.data ?? []);
      setVolunteerHours(volunteerRes.data ?? []);
      setInventory(inventoryRes.data ?? []);

      if (formList.length) {
        const { data: subData } = await supabase
          .from("form_submissions")
          .select("*")
          .in(
            "form_id",
            formList.map((f) => f.id),
          )
          .order("submitted_at", { ascending: false });
        setAllSubmissions(subData ?? []);
      }
      setIsLoading(false);
    };
    load();
  }, [user]);

  useEffect(() => {
    if (!selectedFormId) return;
    const load = async () => {
      const { data } = await supabase
        .from("form_submissions")
        .select("*")
        .eq("form_id", selectedFormId)
        .order("submitted_at", { ascending: false });
      setSubmissions(data ?? []);
      setSearchQuery("");
      setDateFrom("");
      setDateTo("");
    };
    load();
  }, [selectedFormId]);

  // ── Donations helpers ──
  const totalDonations = donations.reduce((s, d) => s + Number(d.amount), 0);
  const donationsByMonth = donations.reduce(
    (acc, d) => {
      const key = new Date(d.date + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
      acc[key] = (acc[key] ?? 0) + Number(d.amount);
      return acc;
    },
    {} as Record<string, number>,
  );
  const donationsByMonthData = Object.entries(donationsByMonth).map(
    ([month, total]) => ({ month, total }),
  );

  const donationsByCampaign = donations.reduce(
    (acc, d) => {
      const key = d.campaign ?? "General";
      acc[key] = (acc[key] ?? 0) + Number(d.amount);
      return acc;
    },
    {} as Record<string, number>,
  );
  const campaignData = Object.entries(donationsByCampaign).map(
    ([name, value]) => ({ name, value }),
  );

  const donationsByMethod = donations.reduce(
    (acc, d) => {
      const key = d.payment_method ?? "Unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const methodData = Object.entries(donationsByMethod).map(([name, value]) => ({
    name,
    value,
  }));

  // ── Volunteer helpers ──
  const totalHours = volunteerHours.reduce((s, v) => s + Number(v.hours), 0);
  const hoursByVolunteer = volunteerHours.reduce(
    (acc, v) => {
      acc[v.volunteer_name] = (acc[v.volunteer_name] ?? 0) + Number(v.hours);
      return acc;
    },
    {} as Record<string, number>,
  );
  const topVolunteers = Object.entries(hoursByVolunteer)
    .map(([name, hours]) => ({
      name: name.length > 14 ? name.slice(0, 14) + "…" : name,
      hours,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 10);

  const hoursByActivity = volunteerHours.reduce(
    (acc, v) => {
      acc[v.activity] = (acc[v.activity] ?? 0) + Number(v.hours);
      return acc;
    },
    {} as Record<string, number>,
  );
  const activityData = Object.entries(hoursByActivity).map(([name, value]) => ({
    name,
    value,
  }));

  const hoursByMonth = volunteerHours.reduce(
    (acc, v) => {
      const key = new Date(v.date + "T00:00:00").toLocaleDateString("en-US", {
        month: "short",
        year: "2-digit",
      });
      acc[key] = (acc[key] ?? 0) + Number(v.hours);
      return acc;
    },
    {} as Record<string, number>,
  );
  const hoursByMonthData = Object.entries(hoursByMonth).map(
    ([month, hours]) => ({ month, hours }),
  );

  // ── Inventory helpers ──
  const lowStockItems = inventory.filter(
    (i) => i.quantity <= (i.low_stock_threshold ?? 5),
  );
  const byCategory = inventory.reduce(
    (acc, i) => {
      const key = i.category ?? "Uncategorized";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const categoryData = Object.entries(byCategory).map(([name, value]) => ({
    name,
    value,
  }));

  // ── Form submission helpers ──
  const selectedForm = forms.find((f) => f.id === selectedFormId);
  const formFields = (selectedForm?.fields as FormField[]) ?? [];

  const getFieldSummary = (field: FormField) => {
    const values = filteredSubmissions
      .map((s) => (s.data as any)?.[field.id])
      .filter((v) => v !== undefined && v !== null && v !== "");
    if (field.type === "number") {
      const nums = values.map(Number).filter((n) => !isNaN(n));
      if (!nums.length) return null;
      return {
        type: "number",
        avg: (nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1),
        min: Math.min(...nums),
        max: Math.max(...nums),
      };
    }
    if (["select", "radio", "checkbox"].includes(field.type)) {
      const counts: Record<string, number> = {};
      values.forEach((v) => {
        const k = String(v);
        counts[k] = (counts[k] || 0) + 1;
      });
      return {
        type: "chart",
        data: Object.entries(counts).map(([name, value]) => ({ name, value })),
      };
    }
    return { type: "text", values: values.map(String).slice(0, 6) };
  };

  const submissionsByDate = () => {
    const byDate: Record<string, number> = {};
    submissions.forEach((s) => {
      const d = new Date(s.submitted_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      byDate[d] = (byDate[d] || 0) + 1;
    });
    return Object.entries(byDate).map(([date, count]) => ({ date, count }));
  };

  // ── Export CSV ──
  const exportCSV = () => {
    let csv = "";
    if (reportType === "donations") {
      csv = [
        "Donor,Amount,Date,Campaign,Method,Notes",
        ...donations.map(
          (d) =>
            `"${d.donor_name}","${d.amount}","${d.date}","${d.campaign ?? ""}","${d.payment_method ?? ""}","${d.notes ?? ""}"`,
        ),
      ].join("\n");
    } else if (reportType === "volunteers") {
      csv = [
        "Volunteer,Activity,Hours,Date,Notes",
        ...volunteerHours.map(
          (v) =>
            `"${v.volunteer_name}","${v.activity}","${v.hours}","${v.date}","${v.notes ?? ""}"`,
        ),
      ].join("\n");
    } else if (reportType === "inventory") {
      csv = [
        "Name,Category,Quantity,Unit,Condition,Location",
        ...inventory.map(
          (i) =>
            `"${i.name}","${i.category ?? ""}","${i.quantity}","${i.unit ?? ""}","${i.condition ?? ""}","${i.location ?? ""}"`,
        ),
      ].join("\n");
    } else if (
      reportType === "forms" &&
      submissions.length &&
      formFields.length
    ) {
      csv =
        ["Submitted At", ...formFields.map((f) => f.label)].join(",") +
        "\n" +
        submissions
          .map((s) =>
            [
              new Date(s.submitted_at).toLocaleString(),
              ...formFields.map((f) => `"${(s.data as any)?.[f.id] ?? ""}"`),
            ].join(","),
          )
          .join("\n");
    }
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportType}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Export PDF ──
  const exportPDF = () => {
    setIsExporting(true);
    const w = window.open("", "_blank");
    if (!w) {
      setIsExporting(false);
      return;
    }

    const date = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    let body = "";

    if (reportType === "impact") {
      body = `
        <h2>Organization Impact Summary</h2>
        <div class="stats-row">
          <div class="stat"><strong>$${totalDonations.toLocaleString()}</strong><span>Total Raised</span></div>
          <div class="stat"><strong>${totalHours.toLocaleString()}</strong><span>Volunteer Hours</span></div>
          <div class="stat"><strong>${allSubmissions.length}</strong><span>Form Responses</span></div>
          <div class="stat"><strong>${inventory.length}</strong><span>Inventory Items</span></div>
        </div>
        <h2>Donations by Campaign</h2>
        <table><thead><tr><th>Campaign</th><th>Total</th></tr></thead><tbody>
          ${campaignData.map((c) => `<tr><td>${c.name}</td><td>$${Number(c.value).toLocaleString()}</td></tr>`).join("")}
        </tbody></table>
        <h2>Top Volunteers</h2>
        <table><thead><tr><th>Volunteer</th><th>Hours</th></tr></thead><tbody>
          ${topVolunteers.map((v) => `<tr><td>${v.name}</td><td>${v.hours}</td></tr>`).join("")}
        </tbody></table>
      `;
    } else if (reportType === "donations") {
      body = `
        <div class="stats-row">
          <div class="stat"><strong>$${totalDonations.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong><span>Total Raised</span></div>
          <div class="stat"><strong>${donations.length}</strong><span>Donations</span></div>
          <div class="stat"><strong>${new Set(donations.map((d) => d.donor_name)).size}</strong><span>Unique Donors</span></div>
        </div>
        <h2>All Donations</h2>
        <table><thead><tr><th>Donor</th><th>Amount</th><th>Date</th><th>Campaign</th><th>Method</th></tr></thead><tbody>
          ${donations.map((d) => `<tr><td>${d.donor_name}</td><td>$${Number(d.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td><td>${d.date}</td><td>${d.campaign ?? "-"}</td><td>${d.payment_method ?? "-"}</td></tr>`).join("")}
        </tbody></table>
      `;
    } else if (reportType === "volunteers") {
      body = `
        <div class="stats-row">
          <div class="stat"><strong>${totalHours}</strong><span>Total Hours</span></div>
          <div class="stat"><strong>${new Set(volunteerHours.map((v) => v.volunteer_name)).size}</strong><span>Volunteers</span></div>
          <div class="stat"><strong>${volunteerHours.length}</strong><span>Sessions</span></div>
        </div>
        <h2>All Volunteer Hours</h2>
        <table><thead><tr><th>Volunteer</th><th>Activity</th><th>Hours</th><th>Date</th></tr></thead><tbody>
          ${volunteerHours.map((v) => `<tr><td>${v.volunteer_name}</td><td>${v.activity}</td><td>${v.hours}</td><td>${v.date}</td></tr>`).join("")}
        </tbody></table>
      `;
    } else if (reportType === "inventory") {
      body = `
        <div class="stats-row">
          <div class="stat"><strong>${inventory.length}</strong><span>Total Items</span></div>
          <div class="stat"><strong>${lowStockItems.length}</strong><span>Low Stock</span></div>
        </div>
        <h2>Inventory</h2>
        <table><thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Unit</th><th>Condition</th><th>Location</th></tr></thead><tbody>
          ${inventory.map((i) => `<tr style="${i.quantity <= (i.low_stock_threshold ?? 5) ? "background:#fff0f0" : ""}"><td>${i.name}</td><td>${i.category ?? "-"}</td><td>${i.quantity}</td><td>${i.unit ?? "-"}</td><td>${i.condition ?? "-"}</td><td>${i.location ?? "-"}</td></tr>`).join("")}
        </tbody></table>
      `;
    } else if (reportType === "forms") {
      body = `
        <div class="stats-row">
          <div class="stat"><strong>${submissions.length}</strong><span>Total Submissions</span></div>
          <div class="stat"><strong>${formFields.length}</strong><span>Fields</span></div>
        </div>
        <h2>All Submissions — ${selectedForm?.title ?? ""}</h2>
        <table><thead><tr><th>#</th>${formFields.map((f) => `<th>${f.label}</th>`).join("")}<th>Date</th></tr></thead><tbody>
          ${submissions.map((s, i) => `<tr><td>${i + 1}</td>${formFields.map((f) => `<td>${(s.data as any)?.[f.id] ?? "-"}</td>`).join("")}<td>${new Date(s.submitted_at).toLocaleDateString()}</td></tr>`).join("")}
        </tbody></table>
      `;
    }

    w.document.write(`<!DOCTYPE html><html><head>
      <title>FormFlow Report — ${date}</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: Georgia, serif; max-width: 960px; margin: 0 auto; padding: 48px 40px; color: #111; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 20px; margin-bottom: 32px; }
        .header-left h1 { font-size: 30px; margin: 0 0 4px; }
        .header-left p { margin: 0; color: #555; font-size: 13px; font-style: italic; }
        .logo { font-size: 13px; color: #888; text-align: right; }
        h2 { font-size: 18px; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-top: 36px; }
        table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
        th { background: #f4f4f4; text-align: left; padding: 8px 12px; border: 1px solid #ddd; font-weight: 600; }
        td { padding: 7px 12px; border: 1px solid #ddd; }
        tr:nth-child(even) td { background: #fafafa; }
        .stats-row { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 16px; }
        .stat { background: #f4f6fa; border-radius: 8px; padding: 16px 24px; text-align: center; flex: 1; min-width: 120px; }
        .stat strong { display: block; font-size: 26px; color: #1a3f8f; margin-bottom: 4px; }
        .stat span { font-size: 12px; color: #666; }
        .footer { margin-top: 48px; border-top: 1px solid #ddd; padding-top: 16px; font-size: 11px; color: #aaa; text-align: center; }
        @media print { body { padding: 24px; } }
      </style>
    </head><body>
      <div class="header">
        <div class="header-left">
          <h1>${REPORT_TYPES.find((r) => r.value === reportType)?.label.replace(/^.+ /, "") ?? "Report"}</h1>
          <p>Generated ${date}</p>
        </div>
        <div class="logo">FormFlow<br/>Impact Reporting</div>
      </div>
      ${body}
      <div class="footer">Generated by FormFlow · ${date} · Confidential</div>
    </body></html>`);
    w.document.close();
    setTimeout(() => {
      w.print();
      setIsExporting(false);
    }, 600);
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold">Reports</h1>
          <p className="text-muted-foreground">
            Visual reports for your board, donors, and grant applications
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="mr-1 h-3.5 w-3.5" /> CSV
          </Button>
          <Button size="sm" onClick={exportPDF} disabled={isExporting}>
            <FileDown className="mr-1 h-3.5 w-3.5" />{" "}
            {isExporting ? "Preparing…" : "Export PDF"}
          </Button>
        </div>
      </div>

      {/* Report type tabs */}
      <div className="flex flex-wrap gap-2">
        {REPORT_TYPES.map((rt) => (
          <button
            key={rt.value}
            onClick={() => setReportType(rt.value)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium border transition-colors ${
              reportType === rt.value
                ? "bg-primary text-primary-foreground border-primary"
                : "border-border hover:border-primary/60 hover:bg-muted"
            }`}
          >
            {rt.label}
          </button>
        ))}
      </div>

      {/* ── IMPACT OVERVIEW ── */}
      {reportType === "impact" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              {
                label: "Total Raised",
                value: `$${totalDonations.toLocaleString()}`,
                icon: DollarSign,
                color: "text-chart-2",
                bg: "bg-chart-2/10",
              },
              {
                label: "Volunteer Hours",
                value: totalHours.toLocaleString(),
                icon: Clock,
                color: "text-chart-3",
                bg: "bg-chart-3/10",
              },
              {
                label: "Form Responses",
                value: allSubmissions.length,
                icon: FileText,
                color: "text-primary",
                bg: "bg-primary/10",
              },
              {
                label: "Inventory Items",
                value: inventory.length,
                icon: Package,
                color: "text-chart-4",
                bg: "bg-chart-4/10",
              },
            ].map((stat) => (
              <Card key={stat.label} className="p-5">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <div
                    className={`h-8 w-8 rounded-md ${stat.bg} flex items-center justify-center`}
                  >
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </div>
                <p className="text-2xl font-bold">{stat.value}</p>
              </Card>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Donations by Month</h3>
              {donationsByMonthData.length > 0 ? (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={donationsByMonthData}>
                      <defs>
                        <linearGradient
                          id="donGrad"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={COLORS[0]}
                            stopOpacity={0.3}
                          />
                          <stop
                            offset="95%"
                            stopColor={COLORS[0]}
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-border"
                      />
                      <XAxis
                        dataKey="month"
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 11,
                        }}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v) => [
                          `$${Number(v).toLocaleString()}`,
                          "Donations",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke={COLORS[0]}
                        fill="url(#donGrad)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No donation data yet
                </p>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-4">Volunteer Hours by Month</h3>
              {hoursByMonthData.length > 0 ? (
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hoursByMonthData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-border"
                      />
                      <XAxis
                        dataKey="month"
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 11,
                        }}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v) => [`${v} hrs`, "Hours"]}
                      />
                      <Bar
                        dataKey="hours"
                        fill={COLORS[2]}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No volunteer data yet
                </p>
              )}
            </Card>
          </div>

          {lowStockItems.length > 0 && (
            <Card className="p-5 border-destructive/40 bg-destructive/5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h3 className="font-semibold text-destructive">
                  Low Stock Items
                </h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {lowStockItems.map((i) => (
                  <Badge key={i.id} variant="destructive">
                    {i.name}: {i.quantity} left
                  </Badge>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── DONATIONS REPORT ── */}
      {reportType === "donations" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              {
                label: "Total Raised",
                value: `$${totalDonations.toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
              },
              { label: "Donations", value: donations.length },
              {
                label: "Unique Donors",
                value: new Set(donations.map((d) => d.donor_name)).size,
              },
              {
                label: "Avg Donation",
                value: donations.length
                  ? `$${(totalDonations / donations.length).toFixed(2)}`
                  : "$0",
              },
            ].map((s) => (
              <Card key={s.label} className="p-5 text-center">
                <p className="text-2xl font-bold text-primary">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </Card>
            ))}
          </div>

          <div className="grid sm:grid-cols-3 gap-6">
            <Card className="p-6 sm:col-span-2">
              <h3 className="font-semibold mb-4">Donations Over Time</h3>
              {donationsByMonthData.length > 0 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={donationsByMonthData}>
                      <defs>
                        <linearGradient
                          id="donGrad2"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor={COLORS[0]}
                            stopOpacity={0.25}
                          />
                          <stop
                            offset="95%"
                            stopColor={COLORS[0]}
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-border"
                      />
                      <XAxis
                        dataKey="month"
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 11,
                        }}
                        tickFormatter={(v) => `$${v}`}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v) => [
                          `$${Number(v).toLocaleString()}`,
                          "Total",
                        ]}
                      />
                      <Area
                        type="monotone"
                        dataKey="total"
                        stroke={COLORS[0]}
                        fill="url(#donGrad2)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground py-12 text-center">
                  No data yet
                </p>
              )}
            </Card>

            <div className="space-y-6">
              <Card className="p-6">
                <h3 className="font-semibold mb-3">By Campaign</h3>
                {campaignData.length > 0 ? (
                  <div className="h-36">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={campaignData}
                          cx="50%"
                          cy="50%"
                          innerRadius={28}
                          outerRadius={52}
                          dataKey="value"
                          paddingAngle={2}
                        >
                          {campaignData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v) => [
                            `$${Number(v).toLocaleString()}`,
                            "",
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    No data
                  </p>
                )}
                <div className="space-y-1 mt-2">
                  {campaignData.slice(0, 4).map((c, i) => (
                    <div
                      key={c.name}
                      className="flex items-center justify-between text-xs gap-2"
                    >
                      <div className="flex items-center gap-1.5">
                        <div
                          className="h-2.5 w-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <span className="truncate">{c.name}</span>
                      </div>
                      <span className="font-medium">
                        ${Number(c.value).toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>

              <Card className="p-6">
                <h3 className="font-semibold mb-3">By Method</h3>
                <div className="space-y-2">
                  {methodData.map((m, i) => (
                    <div
                      key={m.name}
                      className="flex items-center justify-between text-xs gap-2"
                    >
                      <div className="flex items-center gap-1.5">
                        <div
                          className="h-2.5 w-2.5 rounded-sm"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <span>{m.name}</span>
                      </div>
                      <span className="font-medium">{m.value}</span>
                    </div>
                  ))}
                  {!methodData.length && (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      No data
                    </p>
                  )}
                </div>
              </Card>
            </div>
          </div>

          {donations.length > 0 && (
            <Card className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Donor</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Method</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {donations
                    .slice()
                    .reverse()
                    .map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="font-medium">
                          {d.donor_name}
                        </TableCell>
                        <TableCell className="text-right text-primary font-semibold">
                          $
                          {Number(d.amount).toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                          })}
                        </TableCell>
                        <TableCell>{d.date}</TableCell>
                        <TableCell>
                          {d.campaign ? (
                            <Badge variant="secondary">{d.campaign}</Badge>
                          ) : (
                            "-"
                          )}
                        </TableCell>
                        <TableCell>{d.payment_method ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </Card>
          )}
          {!donations.length && (
            <div className="text-center py-16 text-sm text-muted-foreground">
              No donations recorded yet
            </div>
          )}
        </div>
      )}

      {/* ── VOLUNTEER REPORT ── */}
      {reportType === "volunteers" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Hours", value: totalHours.toLocaleString() },
              {
                label: "Volunteers",
                value: new Set(volunteerHours.map((v) => v.volunteer_name))
                  .size,
              },
              { label: "Sessions", value: volunteerHours.length },
              {
                label: "Avg Session",
                value: volunteerHours.length
                  ? `${(totalHours / volunteerHours.length).toFixed(1)} hrs`
                  : "—",
              },
            ].map((s) => (
              <Card key={s.label} className="p-5 text-center">
                <p className="text-2xl font-bold text-primary">{s.value}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </Card>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Top Volunteers</h3>
              {topVolunteers.length > 0 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topVolunteers} layout="vertical">
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-border"
                      />
                      <XAxis
                        type="number"
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={90}
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 11,
                        }}
                      />
                      <Tooltip
                        contentStyle={tooltipStyle}
                        formatter={(v) => [`${v} hrs`, "Hours"]}
                      />
                      <Bar
                        dataKey="hours"
                        fill={COLORS[2]}
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No data yet
                </p>
              )}
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-4">Hours by Activity</h3>
              {activityData.length > 0 ? (
                <>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={activityData}
                          cx="50%"
                          cy="50%"
                          innerRadius={32}
                          outerRadius={60}
                          dataKey="value"
                          paddingAngle={2}
                        >
                          {activityData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={tooltipStyle}
                          formatter={(v) => [`${v} hrs`, ""]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1 mt-2">
                    {activityData.slice(0, 5).map((a, i) => (
                      <div
                        key={a.name}
                        className="flex items-center justify-between text-xs gap-2"
                      >
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-2.5 w-2.5 rounded-sm"
                            style={{
                              backgroundColor: COLORS[i % COLORS.length],
                            }}
                          />
                          <span className="truncate">{a.name}</span>
                        </div>
                        <span className="font-medium">{a.value} hrs</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No data yet
                </p>
              )}
            </Card>
          </div>

          <Card className="p-6">
            <h3 className="font-semibold mb-4">Hours Over Time</h3>
            {hoursByMonthData.length > 0 ? (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hoursByMonthData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="month"
                      tick={{
                        fill: "hsl(var(--muted-foreground))",
                        fontSize: 11,
                      }}
                    />
                    <YAxis
                      tick={{
                        fill: "hsl(var(--muted-foreground))",
                        fontSize: 11,
                      }}
                    />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      formatter={(v) => [`${v} hrs`, "Hours"]}
                    />
                    <Bar
                      dataKey="hours"
                      fill={COLORS[2]}
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">
                No data yet
              </p>
            )}
          </Card>
        </div>
      )}

      {/* ── INVENTORY REPORT ── */}
      {reportType === "inventory" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Items", value: inventory.length },
              { label: "Low Stock", value: lowStockItems.length },
              {
                label: "Out of Stock",
                value: inventory.filter((i) => i.quantity === 0).length,
              },
              { label: "Categories", value: Object.keys(byCategory).length },
            ].map((s) => (
              <Card
                key={s.label}
                className={`p-5 text-center ${s.label === "Low Stock" && s.value > 0 ? "border-destructive/40" : ""}`}
              >
                <p
                  className={`text-2xl font-bold ${s.label === "Low Stock" && s.value > 0 ? "text-destructive" : "text-primary"}`}
                >
                  {s.value}
                </p>
                <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
              </Card>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Stock Levels</h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={inventory.map((i) => ({
                      name:
                        i.name.length > 12 ? i.name.slice(0, 12) + "…" : i.name,
                      quantity: i.quantity,
                      low: i.quantity <= (i.low_stock_threshold ?? 5),
                    }))}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-border"
                    />
                    <XAxis
                      dataKey="name"
                      tick={{
                        fill: "hsl(var(--muted-foreground))",
                        fontSize: 10,
                      }}
                      angle={-30}
                      textAnchor="end"
                      interval={0}
                    />
                    <YAxis
                      tick={{
                        fill: "hsl(var(--muted-foreground))",
                        fontSize: 11,
                      }}
                    />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="quantity" radius={[4, 4, 0, 0]}>
                      {inventory.map((item, i) => (
                        <Cell
                          key={i}
                          fill={
                            item.quantity <= (item.low_stock_threshold ?? 5)
                              ? "hsl(var(--destructive))"
                              : COLORS[0]
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="font-semibold mb-4">Items by Category</h3>
              {categoryData.length > 0 ? (
                <>
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryData}
                          cx="50%"
                          cy="50%"
                          innerRadius={32}
                          outerRadius={60}
                          dataKey="value"
                          paddingAngle={2}
                        >
                          {categoryData.map((_, i) => (
                            <Cell key={i} fill={COLORS[i % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="space-y-1 mt-2">
                    {categoryData.map((c, i) => (
                      <div
                        key={c.name}
                        className="flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-1.5">
                          <div
                            className="h-2.5 w-2.5 rounded-sm"
                            style={{
                              backgroundColor: COLORS[i % COLORS.length],
                            }}
                          />
                          <span>{c.name}</span>
                        </div>
                        <span className="font-medium">{c.value} items</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No categories
                </p>
              )}
            </Card>
          </div>

          {lowStockItems.length > 0 && (
            <Card className="p-5 border-destructive/40 bg-destructive/5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="h-4 w-4 text-destructive" />
                <h3 className="font-semibold text-destructive">
                  Needs Restocking
                </h3>
              </div>
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead>Threshold</TableHead>
                      <TableHead>Category</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lowStockItems.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell className="font-medium">{i.name}</TableCell>
                        <TableCell>
                          <Badge variant="destructive">{i.quantity}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {i.low_stock_threshold ?? 5}
                        </TableCell>
                        <TableCell>{i.category ?? "-"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </div>
      )}
      {/* ── FORM SUBMISSIONS REPORT ── */}
      {reportType === "forms" && (
        <div className="space-y-6">
          {/* Selector + filter bar */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <Select value={selectedFormId} onValueChange={setSelectedFormId}>
                <SelectTrigger className="w-72">
                  <SelectValue placeholder="Select a form…" />
                </SelectTrigger>
                <SelectContent>
                  {forms.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedFormId && (
                <Badge variant="secondary">
                  {filteredSubmissions.length}
                  {hasActiveFilters &&
                  filteredSubmissions.length !== submissions.length
                    ? ` of ${submissions.length}`
                    : ""}{" "}
                  submissions
                </Badge>
              )}
            </div>

            {selectedFormId && submissions.length > 0 && (
              <div className="p-4 rounded-lg border bg-muted/30 space-y-3">
                <div className="flex items-center gap-2">
                  <CalendarRange className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">
                    Filter Submissions
                  </span>
                  {hasActiveFilters && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearFilters}
                      className="ml-auto h-7 text-xs text-muted-foreground"
                    >
                      <X className="mr-1 h-3 w-3" /> Clear filters
                    </Button>
                  )}
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      Search responses
                    </Label>
                    <div className="relative">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Search all fields..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 h-9 text-sm"
                      />
                      {searchQuery && (
                        <button
                          onClick={() => setSearchQuery("")}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      From date
                    </Label>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">
                      To date
                    </Label>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Content */}
          {!selectedFormId ? (
            <Card className="p-6">
              <h3 className="font-semibold mb-4">Submissions by Form</h3>
              {forms.length > 0 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={forms.map((f) => ({
                        name:
                          f.title.length > 16
                            ? f.title.slice(0, 16) + "…"
                            : f.title,
                        submissions: allSubmissions.filter(
                          (s) => s.form_id === f.id,
                        ).length,
                      }))}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-border"
                      />
                      <XAxis
                        dataKey="name"
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 11,
                        }}
                      />
                      <YAxis
                        tick={{
                          fill: "hsl(var(--muted-foreground))",
                          fontSize: 11,
                        }}
                        allowDecimals={false}
                      />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Bar
                        dataKey="submissions"
                        fill={COLORS[0]}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No forms yet
                </p>
              )}
            </Card>
          ) : submissions.length === 0 ? (
            <div className="text-center py-16 text-sm text-muted-foreground">
              No submissions for this form yet
            </div>
          ) : filteredSubmissions.length === 0 ? (
            <div className="text-center py-16 space-y-3">
              <Search className="h-6 w-6 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium">
                No results match your filters
              </p>
              <Button variant="outline" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Total", value: submissions.length },
                  {
                    label: "This Week",
                    value: submissions.filter(
                      (s) =>
                        new Date(s.submitted_at) >
                        new Date(Date.now() - 7 * 86400000),
                    ).length,
                  },
                  {
                    label: "This Month",
                    value: submissions.filter(
                      (s) =>
                        new Date(s.submitted_at) >
                        new Date(Date.now() - 30 * 86400000),
                    ).length,
                  },
                  { label: "Fields", value: formFields.length },
                ].map((s) => (
                  <Card key={s.label} className="p-4 text-center">
                    <p className="text-2xl font-bold">{s.value}</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {s.label}
                    </p>
                  </Card>
                ))}
              </div>

              {submissionsByDate().length > 1 && (
                <Card className="p-6">
                  <h3 className="font-semibold mb-4">Submissions Over Time</h3>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={submissionsByDate()}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-border"
                        />
                        <XAxis
                          dataKey="date"
                          tick={{
                            fill: "hsl(var(--muted-foreground))",
                            fontSize: 11,
                          }}
                        />
                        <YAxis
                          tick={{
                            fill: "hsl(var(--muted-foreground))",
                            fontSize: 11,
                          }}
                          allowDecimals={false}
                        />
                        <Tooltip contentStyle={tooltipStyle} />
                        <Line
                          type="monotone"
                          dataKey="count"
                          stroke={COLORS[0]}
                          strokeWidth={2}
                          dot={false}
                          name="Submissions"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              )}

              {formFields.filter((f) =>
                ["select", "radio", "checkbox"].includes(f.type),
              ).length > 0 && (
                <div className="grid sm:grid-cols-2 gap-6">
                  {formFields
                    .filter((f) =>
                      ["select", "radio", "checkbox"].includes(f.type),
                    )
                    .map((field) => {
                      const summary = getFieldSummary(field);
                      if (!summary || summary.type !== "chart") return null;
                      const d = summary.data as any[];
                      return (
                        <Card key={field.id} className="p-6">
                          <h4 className="font-semibold mb-3">{field.label}</h4>
                          <div className="h-44">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={d}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={35}
                                  outerRadius={62}
                                  paddingAngle={2}
                                  dataKey="value"
                                  label={({ name, percent }) =>
                                    `${name} ${(percent * 100).toFixed(0)}%`
                                  }
                                >
                                  {d.map((_, i) => (
                                    <Cell
                                      key={i}
                                      fill={COLORS[i % COLORS.length]}
                                    />
                                  ))}
                                </Pie>
                                <Tooltip contentStyle={tooltipStyle} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        </Card>
                      );
                    })}
                </div>
              )}

              {formFields
                .filter((f) => f.type === "number")
                .map((field) => {
                  const summary = getFieldSummary(field);
                  if (!summary || summary.type !== "number") return null;
                  return (
                    <Card key={field.id} className="p-6">
                      <h4 className="font-semibold mb-3">
                        {field.label} - Statistics
                      </h4>
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          ["Average", summary.avg],
                          ["Min", summary.min],
                          ["Max", summary.max],
                        ].map(([l, v]) => (
                          <div
                            key={l as string}
                            className="text-center p-4 bg-muted/40 rounded-md"
                          >
                            <p className="text-xl font-bold">{v}</p>
                            <p className="text-xs text-muted-foreground">{l}</p>
                          </div>
                        ))}
                      </div>
                    </Card>
                  );
                })}

              <Card className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      {formFields.map((f) => (
                        <TableHead key={f.id}>{f.label}</TableHead>
                      ))}
                      <TableHead>Submitted</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSubmissions.map((sub, idx) => (
                      <TableRow key={sub.id}>
                        <TableCell className="text-muted-foreground text-xs">
                          {idx + 1}
                        </TableCell>
                        {formFields.map((f) => (
                          <TableCell
                            key={f.id}
                            className="max-w-[160px] truncate"
                          >
                            {String((sub.data as any)?.[f.id] ?? "-")}
                          </TableCell>
                        ))}
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(sub.submitted_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </>
          )}
        </div>
      )}
    </div>
  );
}
