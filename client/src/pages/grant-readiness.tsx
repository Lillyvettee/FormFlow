/**
 * GrantReadinessPage
 *
 * Route: /grants. Operations section, Mission and Enterprise (migration 025).
 * Three tabs:
 *   Impact numbers  figures for any period, ready to paste (ImpactNumbers)
 *   Narratives      reusable answers to common grant questions (Narratives)
 *   Grants          application tracker and grant packets (GrantsTracker)
 */

import { useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useOrganization } from "@/hooks/use-organization";
import { ImpactNumbers } from "@/components/operations/impact-numbers";
import { Narratives } from "@/components/operations/narratives";
import { GrantsTracker } from "@/components/operations/grants-tracker";

const TAB_KEY = "hm-grants-tab";
const TABS = ["numbers", "narratives", "grants"];

export default function GrantReadinessPage() {
  const { plan } = useOrganization();

  useEffect(() => {
    document.title = "Grant readiness - HumMotion";
  }, []);

  if (!plan.features.operations) {
    return (
      <div className="p-6 max-w-xl mx-auto">
        <Card className="p-6 space-y-2">
          <h1 className="text-xl font-serif font-bold">Grant readiness</h1>
          <p className="text-sm text-muted-foreground">
            Impact numbers ready to paste, reusable grant narratives, a grant tracker and one-click grant packets. Included with the
            Mission and Enterprise plans.{" "}
            <a href="/settings#plan" className="underline hover:text-foreground">
              See plans
            </a>
          </p>
        </Card>
      </div>
    );
  }

  let initialTab = "numbers";
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved && TABS.includes(saved)) initialTab = saved;
  } catch {
    // Remembering the tab is a convenience only.
  }

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-serif font-bold">Grant readiness</h1>
        <p className="text-muted-foreground">Everything you need for a grant application: your numbers, your words, and your deadlines.</p>
      </div>

      <Tabs
        defaultValue={initialTab}
        onValueChange={(v) => {
          try {
            localStorage.setItem(TAB_KEY, v);
          } catch {
            // Remembering the tab is a convenience only.
          }
        }}
      >
        <TabsList>
          <TabsTrigger value="numbers">Impact numbers</TabsTrigger>
          <TabsTrigger value="narratives">Narratives</TabsTrigger>
          <TabsTrigger value="grants">Grants</TabsTrigger>
        </TabsList>
        <TabsContent value="numbers" className="pt-4">
          <ImpactNumbers />
        </TabsContent>
        <TabsContent value="narratives" className="pt-4">
          <Narratives />
        </TabsContent>
        <TabsContent value="grants" className="pt-4">
          <GrantsTracker />
        </TabsContent>
      </Tabs>
    </div>
  );
}
