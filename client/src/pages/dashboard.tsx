import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { FileText, BarChart3, Package, LinkIcon, Plus, ArrowRight, TrendingUp } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import type { Form, InventoryItem, Link as LinkType } from "@/types/database";

export default function DashboardPage() {
  const { user } = useAuth();
  const [forms, setForms] = useState<Form[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [links, setLinks] = useState<LinkType[]>([]);
  const [totalResponses, setTotalResponses] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      setIsLoading(true);
      const [formsRes, inventoryRes, linksRes] = await Promise.all([
        supabase.from("forms").select("*").eq("user_id", user.id).eq("is_archived", false),
        supabase.from("inventory_items").select("*").eq("user_id", user.id),
        supabase.from("links").select("*").eq("user_id", user.id),
      ]);
      const formList = formsRes.data ?? [];
      setForms(formList);
      setInventoryItems(inventoryRes.data ?? []);
      setLinks(linksRes.data ?? []);
      setTotalResponses(formList.reduce((sum, f) => sum + (f.response_count ?? 0), 0));
      setIsLoading(false);
    };
    load();
  }, [user]);

  const stats = [
    { label: "Active Forms", value: forms.length, icon: FileText, color: "text-primary", bg: "bg-primary/10" },
    { label: "Responses", value: totalResponses, icon: BarChart3, color: "text-chart-2", bg: "bg-chart-2/10" },
    { label: "Resources", value: inventoryItems.length, icon: Package, color: "text-chart-3", bg: "bg-chart-3/10" },
    { label: "Saved Links", value: links.length, icon: LinkIcon, color: "text-chart-4", bg: "bg-chart-4/10" },
  ];

  const quickActions = [
    { label: "New Form", icon: FileText, href: "/forms", testId: "button-new-form" },
    { label: "View Reports", icon: BarChart3, href: "/reports", testId: "button-view-reports" },
    { label: "Track Resources", icon: Package, href: "/inventory", testId: "button-add-inventory" },
    { label: "Add Link", icon: LinkIcon, href: "/links", testId: "button-add-link" },
  ];

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold" data-testid="text-dashboard-title">Dashboard</h1>
        <p className="text-muted-foreground">Welcome back. Here's an overview of your organization.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-5">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-8 w-12" />
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1.5">
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-bold">{stat.value}</p>
                </div>
                <div className={`h-10 w-10 rounded-md ${stat.bg} flex items-center justify-center shrink-0`}>
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
            )}
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-6">
          <div className="flex items-center justify-between gap-4 mb-5">
            <div className="space-y-0.5">
              <h2 className="font-semibold text-lg">Recent Forms</h2>
              <p className="text-sm text-muted-foreground">Your latest form templates</p>
            </div>
            <Link href="/forms">
              <Button variant="outline" size="sm" data-testid="button-view-all-forms">
                View All <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : forms.length > 0 ? (
            <div className="space-y-2">
              {forms.slice(0, 5).map((form) => (
                <div key={form.id} className="flex items-center justify-between gap-4 p-3 rounded-md hover-elevate">
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
            <div className="text-center py-12 space-y-3">
              <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                <FileText className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No forms created yet</p>
              <Link href="/forms">
                <Button size="sm" data-testid="button-create-first-form">
                  <Plus className="mr-1 h-3.5 w-3.5" /> Create Your First Form
                </Button>
              </Link>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <div className="space-y-0.5 mb-5">
            <h2 className="font-semibold text-lg">Quick Actions</h2>
            <p className="text-sm text-muted-foreground">Jump to common tasks</p>
          </div>
          <div className="space-y-2">
            {quickActions.map((action) => (
              <Link key={action.label} href={action.href}>
                <button className="w-full flex items-center gap-3 p-3 rounded-md text-left hover-elevate" data-testid={action.testId}>
                  <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <action.icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <span className="text-sm font-medium">{action.label}</span>
                  <ArrowRight className="ml-auto h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </Link>
            ))}
          </div>
          <div className="mt-6 p-4 rounded-md bg-primary/5 border border-primary/10">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Tip</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Create volunteer sign-ups, donation forms, or surveys and share them with your community to start collecting data.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
