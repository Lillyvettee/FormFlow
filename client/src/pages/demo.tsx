/**
 * DemoPage
 *
 * Route: /demo. Lets visitors try the app without creating an account.
 *
 * Signs the visitor in as a temporary anonymous user, gives them their own
 * demo organization filled with a sample food bank's records (seed_demo_data,
 * migration 006), and sends them to the dashboard. DemoBanner then shows
 * across the app until they create a real account.
 *
 * Needs anonymous sign-ins turned on in Supabase
 * (Authentication > Sign In / Providers > Allow anonymous sign-ins).
 * If they are off, the page says so and offers sign-up instead.
 *
 * Someone already signed in with a real account just goes to the dashboard.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/lib/supabase";
import { AlertCircle } from "lucide-react";

const DEMO_ORGANIZATION_NAME = "Riverside Food Bank (demo)";

export default function DemoPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        let user = sessionData.session?.user ?? null;

        if (!user) {
          const { data, error: signInError } = await supabase.auth.signInAnonymously();
          if (signInError) throw signInError;
          user = data.user;
        }

        // Demo visitors get their own organization so every page works.
        // Real accounts, and demo visitors coming back, already have one.
        if (user?.is_anonymous) {
          const { data: membership, error: memberError } = await supabase
            .from("organization_members")
            .select("organization_id")
            .eq("user_id", user.id)
            .maybeSingle();
          if (memberError) throw memberError;
          if (!membership) {
            const { error: createError } = await supabase.rpc("create_organization", { p_name: DEMO_ORGANIZATION_NAME });
            if (createError) throw createError;
            // Sample records. Not essential: if this fails the demo still works, just empty.
            const { error: seedError } = await supabase.rpc("seed_demo_data");
            if (seedError) console.warn("Couldn't add demo sample data:", seedError.message);
          }
        }

        // Full reload so the organization provider picks up the new membership.
        if (!cancelled) window.location.replace("/");
      } catch (err) {
        if (!cancelled) {
          setError(
            err && typeof err === "object" && "message" in err
              ? String((err as { message: string }).message)
              : "Couldn't start the demo.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md p-8 space-y-5 text-center">
        {error ? (
          <>
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
            <h1 className="text-xl font-serif font-bold">The demo isn't available right now</h1>
            <p role="alert" className="text-sm text-muted-foreground">
              {error}
            </p>
            <div className="flex flex-col gap-2">
              <Button asChild>
                <a href="/signup">Create a free account</a>
              </Button>
              <Button asChild variant="outline">
                <a href="/">Back to home</a>
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-12 w-12 rounded-full mx-auto" />
            <p className="text-sm text-muted-foreground">Setting up your demo...</p>
          </div>
        )}
      </Card>
    </div>
  );
}
