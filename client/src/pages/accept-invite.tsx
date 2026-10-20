/**
 * AcceptInvitePage
 *
 * Where invite links land. Place at: client/src/pages/accept-invite.tsx
 * Route: /invite/:token. Must be OUTSIDE OrganizationGate (invited people
 * have no organization yet) but INSIDE OrganizationProvider.
 *
 * What the visitor sees:
 *   - Unknown, used or expired link:   an explanation
 *   - Signed out:                      who invited them, plus "Sign in" and
 *                                      "Create account" buttons that return here
 *   - Signed in with a different email: how to switch accounts
 *   - Signed in with the invited email: an "Accept" button, or, if they
 *                                      already have their own organization,
 *                                      JoinWithExistingOrg (bring or delete
 *                                      their records; migration 018)
 *
 * After accepting, they go to the dashboard as a member of the organization.
 */

import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/lib/supabase";
import { useOrganization, ROLE_LABELS, ROLE_DESCRIPTIONS, type OrgRole } from "@/hooks/use-organization";
import { JoinWithExistingOrg } from "@/components/join-with-existing-org";
import { Users, AlertCircle, ArrowRight } from "lucide-react";

/** Details returned by the get_invitation database function. */
interface InvitationInfo {
  organization_name: string;
  email: string;
  role: OrgRole;
  status: "valid" | "expired" | "accepted";
}

/** Tokens are UUIDs; anything else is rejected before calling the database. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function AcceptInvitePage() {
  const { token = "" } = useParams<{ token: string }>();
  const { organization, refresh } = useOrganization();

  const [invite, setInvite] = useState<InvitationInfo | null>(null);
  /** Email of whoever is signed in on this browser, or null if signed out. */
  const [sessionEmail, setSessionEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isAccepting, setIsAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState("");

  // -------------------------------------------------------------------------
  // Load the invitation and the current session together.
  // The session is read directly from Supabase (rather than useAuth) so the
  // page never briefly shows "Sign in" to someone who is already signed in.
  // -------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!UUID_PATTERN.test(token)) {
        setLoadError("This invitation link is not valid. Check that you copied the whole link.");
        setIsLoading(false);
        return;
      }
      try {
        const [{ data: sessionData }, { data, error }] = await Promise.all([
          supabase.auth.getSession(),
          supabase.rpc("get_invitation", { p_token: token }),
        ]);
        if (cancelled) return;
        if (error) throw error;

        const row = (Array.isArray(data) ? data[0] : data) as InvitationInfo | undefined;
        if (!row) {
          setLoadError("This invitation link is not valid. It may have been revoked. Ask for a new one.");
        } else {
          setInvite(row);
        }
        setSessionEmail(sessionData.session?.user.email ?? null);
      } catch {
        if (!cancelled) setLoadError("Couldn't load this invitation. Check your connection and refresh the page.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /** Accept, reload the organization, then go to the dashboard. */
  const accept = async () => {
    setIsAccepting(true);
    setAcceptError("");
    try {
      const { error } = await supabase.rpc("accept_invitation", { p_token: token });
      if (error) throw error;
      await refresh();
      window.location.replace("/");
    } catch (err) {
      setAcceptError(
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Couldn't accept the invitation. Try again.",
      );
      setIsAccepting(false);
    }
  };

  /** Sign out of the wrong account and stay on this page, ready to sign in as the invited email. */
  const switchAccount = async () => {
    await supabase.auth.signOut();
    setSessionEmail(null);
  };

  // Links that bring the person back here after signing in or signing up.
  const returnPath = `/invite/${token}`;
  const loginHref = `/login?${new URLSearchParams({ redirect: returnPath, ...(invite ? { email: invite.email } : {}) })}`;
  const signupHref = `/signup?${new URLSearchParams({ redirect: returnPath })}`;

  const emailMatches = Boolean(
    invite && sessionEmail && invite.email.toLowerCase() === sessionEmail.toLowerCase(),
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md p-8 space-y-5 text-center">
        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-12 w-12 rounded-full mx-auto" />
            <Skeleton className="h-6 w-56 mx-auto" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </div>
        ) : loadError || !invite ? (
          // ----- Bad link -----
          <>
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
            <h1 className="text-xl font-serif font-bold">Invitation not found</h1>
            <p className="text-sm text-muted-foreground">{loadError}</p>
          </>
        ) : invite.status === "accepted" ? (
          // ----- Already used -----
          <>
            <Users className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
            <h1 className="text-xl font-serif font-bold">Invitation already used</h1>
            <p className="text-sm text-muted-foreground">
              This invitation to <strong className="text-foreground">{invite.organization_name}</strong> has already been
              accepted.
            </p>
            <Button asChild>
              <a href={organization ? "/" : loginHref}>
                {organization ? "Go to dashboard" : "Sign in"} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
          </>
        ) : invite.status === "expired" ? (
          // ----- Expired -----
          <>
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
            <h1 className="text-xl font-serif font-bold">Invitation expired</h1>
            <p className="text-sm text-muted-foreground">
              This invitation to <strong className="text-foreground">{invite.organization_name}</strong> has expired. Ask
              the person who invited you to send a new one.
            </p>
          </>
        ) : (
          // ----- Valid invitation -----
          <>
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center mx-auto" aria-hidden="true">
              <Users className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-serif font-bold">Join {invite.organization_name}</h1>
              <p className="text-sm text-muted-foreground">
                You've been invited as {invite.role === "admin" ? "an" : "a"}{" "}
                <strong className="text-foreground">{ROLE_LABELS[invite.role].toLowerCase()}</strong>.{" "}
                {ROLE_DESCRIPTIONS[invite.role]}
              </p>
            </div>

            {acceptError && (
              <p role="alert" className="text-sm text-destructive">
                {acceptError}
              </p>
            )}

            {!sessionEmail ? (
              // Signed out: sign in or create an account, then come back here.
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This invitation is for <strong className="text-foreground break-all">{invite.email}</strong>.
                </p>
                <div className="flex flex-col gap-2">
                  <Button asChild>
                    <a href={signupHref}>Create an account</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={loginHref}>I already have an account</a>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Use {invite.email} when you sign up or sign in.</p>
              </div>
            ) : emailMatches && organization ? (
              // Signed in as the invited person, who already has an organization.
              <JoinWithExistingOrg token={token} teamName={invite.organization_name} onPlainJoin={accept} />
            ) : emailMatches ? (
              // Signed in as the invited person.
              <Button className="w-full" onClick={accept} disabled={isAccepting}>
                {isAccepting ? "Joining..." : `Join ${invite.organization_name}`}
              </Button>
            ) : (
              // Signed in as someone else.
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  You're signed in as <strong className="text-foreground break-all">{sessionEmail}</strong>, but this
                  invitation is for <strong className="text-foreground break-all">{invite.email}</strong>.
                </p>
                <Button variant="outline" className="w-full" onClick={switchAccount}>
                  Sign out and switch accounts
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
