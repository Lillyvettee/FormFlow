/**
 * OrganizationGate
 *
 * Wraps the signed-in part of the app. Shows the app only once the user
 * belongs to an organization. Place at: client/src/components/organization-gate.tsx
 *
 *   - Loading:          a skeleton
 *   - Load error:       a message with "Try again"
 *   - No organization:  a short setup screen to create one
 *   - Otherwise:        the app
 *
 * People joining an existing team never see the setup screen: they open their
 * invite link, which goes to /invite/:token. That route sits outside this gate.
 */

import { useState, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { Building2, AlertCircle, Mail } from "lucide-react";

export function OrganizationGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { organization, isLoading, error, refresh, createOrganization } = useOrganization();

  // Pre-fill with the organization name entered at sign-up, if any.
  const [name, setName] = useState<string>(user?.user_metadata?.organization_name ?? "");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  // ----- Loading -----
  if (isLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  // ----- Could not load membership -----
  if (error) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <Card role="alert" className="max-w-md w-full p-6 space-y-4 text-center">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto" aria-hidden="true" />
          <p className="text-sm">Couldn't load your organization: {error}</p>
          <Button variant="outline" onClick={refresh}>
            Try again
          </Button>
        </Card>
      </div>
    );
  }

  // ----- Has an organization: show the app -----
  if (organization) return <>{children}</>;

  // ----- No organization yet: setup screen -----
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isCreating) return;
    setIsCreating(true);
    setCreateError("");
    try {
      await createOrganization(name.trim());
      // The provider reloads, and this gate then renders the app.
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Couldn't create your organization. Try again.");
      setIsCreating(false);
    }
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4">
        <Card className="p-6 space-y-5">
          <div className="space-y-2 text-center">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto" aria-hidden="true">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-xl font-serif font-bold">Set up your organization</h1>
            <p className="text-sm text-muted-foreground">
              Your forms, donations, volunteer hours and other records are shared with everyone you invite to it.
            </p>
          </div>

          <form onSubmit={handleCreate} className="space-y-4">
            {createError && (
              <p role="alert" className="text-sm text-destructive">
                {createError}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization name</Label>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Riverside Food Bank"
                maxLength={150}
                autoComplete="organization"
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={!name.trim() || isCreating}>
              {isCreating ? "Creating..." : "Create organization"}
            </Button>
          </form>
        </Card>

        {/* Guidance for people who meant to join an existing team. */}
        <p className="flex items-start gap-2 text-sm text-muted-foreground px-1">
          <Mail className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            Joining an existing team? Open the invite link you were sent instead. It adds you to their organization
            automatically.
          </span>
        </p>
      </div>
    </div>
  );
}
