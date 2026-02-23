import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  FileText, BarChart3, Package, LinkIcon, Plus, ArrowRight,
  DollarSign, Clock, AlertTriangle, CheckCircle2, Users, TrendingUp, Image
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { Form, InventoryItem } from "@/types/database";

interface DashboardData {
  forms: Form[];
  totalSubmissions: number;
  submissionsThisMonth: number;
  inventoryItems: InventoryItem[];
  totalDonations: number;
  donationsThisMonth: number;
  totalVolunteerHours: number;
  volunteerHoursThisMonth: number;
  recentActivity: { label: string; time: string; type: string }[];
  submissionsByDay: { date: string; count: number }[];
}

const LOW_STOCK = 5;

export default function DashboardPage() {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setIsLoading(true);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

      const [
        formsRes, inventoryRes,
        submissionsRes, donationsRes, volunteerRes,
      ] = await Promise.all([
        supabase.from("forms").select("*").eq("user_id", user.id).eq("is_archived", false).order("created_at", { ascending: false }),
        supabase.from("inventory_items").select("*").eq("user_id", user.id),
        supabase.from("form_submissions").select("submitted_at, form_id").in(
          "form_id",
          (await supabase.from("forms").select("id").eq("user_id", user.id)).data?.map(f => f.id) ?? []
        ).order("submitted_at", { ascending: false }).limit(200),
        supabase.from("donations").select("amount, created_at, donor_name").eq("user_id", user.id).order("created_at", { ascending: false }),
        supabase.from("volunteer_hours").select("hours, created_at, volunteer_name, activity").eq("user_id", user.id).order("created_at", { ascending: false }),
      ]);

      const forms = formsRes.data ?? [];
      const inventory = inventoryRes.data ?? [];
      const submissions = submissionsRes.data ?? [];
      const donations = donationsRes.data ?? [];
      const volunteerHours = volunteerRes.data ?? [];

      // Submissions by day (last 14 days)
      const dayMap: Record<string, number> = {};
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        dayMap[d.toLocaleDateString("en-US", { month: "short", day: "numeric" })] = 0;
      }
      submissions.forEach(s => {
        const label = new Date(s.submitted_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        if (label in dayMap) dayMap[label]++;
      });
      const submissionsByDay = Object.entries(dayMap).map(([date, count]) => ({ date, count }));

      // Recent activity feed (last 8 events across all tables)
      const activity: { label: string; time: string; type: string; ts: number }[] = [];

      submissions.slice(0, 5).forEach(s => {
        const form = forms.find(f => f.id === s.form_id);
        activity.push({ label: `New submission on "${form?.title ?? "form"}"`, time: new Date(s.submitted_at).toLocaleDateString(), type: "form", ts: new Date(s.submitted_at).getTime() });
      });
      donations.slice(0, 3).forEach(d => {
        activity.push({ label: `$${Number(d.amount).toLocaleString()} donation from ${d.donor_name}`, time: new Date(d.created_at).toLocaleDateString(), type: "donation", ts: new Date(d.created_at).getTime() });
      });
      volunteerHours.slice(0, 3).forEach(v => {
        activity.push({ label: `${v.hours}h logged by ${v.volunteer_name} — ${v.activity}`, time: new Date(v.created_at).toLocaleDateString(), type: "volunteer", ts: new Date(v.created_at).getTime() });
      });
      activity.sort((a, b) => b.ts - a.ts);

      setData({
        forms,
        totalSubmissions: submissions.length,
        submissionsThisMonth: submissions.filter(s => s.submitted_at > thirtyDaysAgo).length,
        inventoryItems: inventory,
        totalDonations: donations.reduce((s, d) => s + Number(d.amount), 0),
        donationsThisMonth: donations.filter(d => d.created_at > thirtyDaysAgo).reduce((s, d) => s + Number(d.amount), 0),
        totalVolunteerHours: volunteerHours.reduce((s, v) => s + Number(v.hours), 0),
        volunteerHoursThisMonth: volunteerHours.filter(v => v.created_at > thirtyDaysAgo).reduce((s, v) => s + Number(v.hours), 0),
        recentActivity: activity.slice(0, 8),
        submissionsByDay,
      });

      setIsLoading(false);
    };
    load();
  }, [user]);

  const fullName = user?.user_metadata?.full_name?.split(" ")[0] ?? "there";
  const lowStockItems = data?.inventoryItems.filter(i => i.quantity <= LOW_STOCK) ?? [];

  const stats = data ? [
    {
      label: "Total Raised",
      value: `$${data.totalDonations.toLocaleString("en-US", { minimumFractionDigits: 0 })}`,
      sub: `$${data.donationsThisMonth.toLocaleString()} this month`,
      icon: DollarSign,
      color: "text-chart-2",
      bg: "bg-chart-2/10",
      href: "/donations",
    },
    {
      label: "Volunteer Hours",
      value: data.totalVolunteerHours.toLocaleString(),
      sub: `${data.volunteerHoursThisMonth} this month`,
      icon: Clock,
      color: "text-chart-3",
      bg: "bg-chart-3/10",
      href: "/volunteer-hours",
    },
    {
      label: "Form Submissions",
      value: data.totalSubmissions.toLocaleString(),
      sub: `${data.submissionsThisMonth} this month`,
      icon: FileText,
      color: "text-primary",
      bg: "bg-primary/10",
      href: "/reports",
    },
    {
      label: "Active Forms",
      value: data.forms.filter(f => f.is_published).length,
      sub: `${data.forms.length} total`,
      icon: BarChart3,
      color: "text-chart-4",
      bg: "bg-chart-4/10",
      href: "/forms",
    },
  ] : [];

  const quickActions = [
    { label: "New Form", icon: FileText, href: "/forms" },
    { label: "Record Donation", icon: DollarSign, href: "/donations" },
    { label: "Log Volunteer Hours", icon: Clock, href: "/volunteer-hours" },
    { label: "Add Inventory Item", icon: Package, href: "/inventory" },
    { label: "Upload Media", icon: Image, href: "/media" },
    { label: "View Reports", icon: BarChart3, href: "/reports" },
  ];

  const activityIcons: Record<string, any> = {
    form: FileText,
    donation: DollarSign,
    volunteer: Users,
  };
  const activityColors: Record<string, string> = {
    form: "bg-primary/10 text-primary",
    donation: "bg-chart-2/10 text-chart-2",
    volunteer: "bg-chart-3/10 text-chart-3",
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-serif font-bold" data-testid="text-dashboard-title">
            Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 17 ? "afternoon" : "evening"}, {fullName} 👋
          </h1>
          <p className="text-muted-foreground">Here's your organization's impact at a glance</p>
        </div>
        <Link href="/forms">
          <Button data-testid="button-new-form">
            <Plus className="mr-1 h-4 w-4" /> New Form
          </Button>
        </Link>
      </div>

      {/* Low stock alert */}
      {lowStockItems.length > 0 && (
        <Card className="p-4 border-destructive/40 bg-destructive/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            <span className="text-sm font-medium text-destructive">Low Stock Alert</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {lowStockItems.map(i => (
              <Link key={i.id} href="/inventory">
                <Badge variant="destructive" className="cursor-pointer text-xs">
                  {i.name}: {i.quantity === 0 ? "Out of stock" : `${i.quantity} left`}
                </Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          [1,2,3,4].map(i => <Card key={i} className="p-5"><Skeleton className="h-20 w-full" /></Card>)
        ) : stats.map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="p-5 hover-elevate cursor-pointer group">
              <div className="flex items-start justify-between gap-3 mb-3">
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <div className={`h-9 w-9 rounded-md ${stat.bg} flex items-center justify-center shrink-0`}>
                  <stat.icon className={`h-4.5 w-4.5 ${stat.color}`} />
                </div>
              </div>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> {stat.sub}
              </p>
            </Card>
          </Link>
        ))}
      </div>

      {/* Chart + Activity */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Submissions chart */}
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div>
              <h2 className="font-semibold text-lg">Submissions — Last 14 Days</h2>
              <p className="text-sm text-muted-foreground">Form responses received per day</p>
            </div>
            <Link href="/reports">
              <Button variant="outline" size="sm">
                Reports <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          {isLoading ? <Skeleton className="h-48 w-full" /> : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data?.submissionsByDay ?? []}>
                  <defs>
                    <linearGradient id="subGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(217, 91%, 35%)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(217, 91%, 35%)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} interval={1} />
                  <YAxis tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ backgroundColor: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: "6px", color: "hsl(var(--foreground))" }} />
                  <Area type="monotone" dataKey="count" stroke="hsl(217, 91%, 35%)" fill="url(#subGrad)" strokeWidth={2} name="Submissions" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Recent activity */}
        <Card className="p-6">
          <h2 className="font-semibold text-lg mb-4">Recent Activity</h2>
          {isLoading ? (
            <div className="space-y-3">{[1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : data?.recentActivity.length ? (
            <div className="space-y-3">
              {data.recentActivity.map((item, i) => {
                const Icon = activityIcons[item.type] ?? CheckCircle2;
                const color = activityColors[item.type] ?? "bg-muted text-muted-foreground";
                return (
                  <div key={i} className="flex items-start gap-3">
                    <div className={`h-8 w-8 rounded-md flex items-center justify-center shrink-0 ${color}`}>
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug truncate">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.time}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8 space-y-2">
              <CheckCircle2 className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">No activity yet — start by creating a form!</p>
            </div>
          )}
        </Card>
      </div>

      {/* Bottom row: recent forms + quick actions */}
      <div className="grid lg:grid-cols-3 gap-6">
        {/* Recent forms */}
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <h2 className="font-semibold text-lg">Recent Forms</h2>
            <Link href="/forms">
              <Button variant="outline" size="sm" data-testid="button-view-all-forms">
                View All <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : data?.forms.length ? (
            <div className="space-y-2">
              {data.forms.slice(0, 5).map((form) => (
                <div key={form.id} className="flex items-center justify-between gap-4 p-3 rounded-md hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <FileText className="h-4 w-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{form.title}</p>
                      <p className="text-xs text-muted-foreground">{(form.fields as any[])?.length ?? 0} fields</p>
                    </div>
                  </div>
                  <Badge variant={form.is_published ? "default" : "secondary"}>
                    {form.is_published ? "Published" : "Draft"}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10 space-y-3">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                <FileText className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No forms yet</p>
              <Link href="/forms">
                <Button size="sm" data-testid="button-create-first-form">
                  <Plus className="mr-1 h-3.5 w-3.5" /> Create Your First Form
                </Button>
              </Link>
            </div>
          )}
        </Card>

        {/* Quick actions */}
        <Card className="p-6">
          <h2 className="font-semibold text-lg mb-4">Quick Actions</h2>
          <div className="space-y-1.5">
            {quickActions.map((action) => (
              <Link key={action.label} href={action.href}>
                <button className="w-full flex items-center gap-3 p-2.5 rounded-md text-left hover:bg-muted/60 transition-colors group">
                  <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0 group-hover:bg-primary/10 transition-colors">
                    <action.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <span className="text-sm font-medium">{action.label}</span>
                  <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
