/**
 * use-organization
 *
 * Provides the signed-in user's organization and role to the whole app.
 * Place at: client/src/hooks/use-organization.tsx (next to use-auth).
 *
 * Usage:
 *   const { organization, role, canEdit, isAdmin } = useOrganization();
 *
 *   canEdit   true for owners, admins and members while the organization is
 *             in its free trial or subscribed. Use it to hide add, edit and
 *             delete buttons from viewers and from read-only organizations.
 *   isAdmin   true for owners and admins. Use it for team and settings controls.
 *   billing   trial and subscription details (see Billing below).
 *   branding  the organization's color and logo from Settings > Branding.
 *             The color is applied to the whole app here (lib/brand-color).
 *
 * These flags only control what the UI shows. The database security rules
 * enforce the same permissions, so hiding a button is a convenience, not
 * the protection.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";
import { setBrandColor } from "@/lib/brand-color";

// ===========================================================================
// Types and role metadata
// ===========================================================================

export type OrgRole = "owner" | "admin" | "member" | "viewer";

export interface Organization {
  id: string;
  name: string;
}

/** The organization's row in organization_billing (see migration 004). */
export interface OrganizationBilling {
  trial_ends_at: string;
  /** Stripe's subscription status, or null if never subscribed. */
  status: string | null;
  plan: "starter" | "mission" | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

/** From organization_settings. Either may be null if never set. */
export interface Branding {
  primaryColor: string | null;
  logoUrl: string | null;
}

/** Billing state worked out from OrganizationBilling. */
export interface Billing {
  details: OrganizationBilling | null;
  /** Has a working subscription (including a Stripe trial or a payment being retried). */
  isSubscribed: boolean;
  /** In the free 30 days and not yet subscribed. */
  isOnTrial: boolean;
  /** Whole days left in the free trial, 0 once it has ended. */
  trialDaysLeft: number;
  /** Trial or subscription active. When false the organization is read-only. */
  hasAccess: boolean;
}

const SUBSCRIBED_STATUSES = ["active", "trialing", "past_due"];

/** Mirrors org_has_access() in the database, which is what actually enforces read-only. */
function describeBilling(details: OrganizationBilling | null): Billing {
  const isSubscribed = Boolean(details?.status && SUBSCRIBED_STATUSES.includes(details.status));
  const msLeft = details ? new Date(details.trial_ends_at).getTime() - Date.now() : 0;
  const trialDaysLeft = Math.max(0, Math.ceil(msLeft / 86_400_000));
  const isOnTrial = !isSubscribed && msLeft > 0;
  return { details, isSubscribed, isOnTrial, trialDaysLeft, hasAccess: isSubscribed || isOnTrial };
}

/** Display names for roles. */
export const ROLE_LABELS: Record<OrgRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

/** One-line explanation of each role, shown on the Team page and in invites. */
export const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
  owner: "Full control, including managing other owners.",
  admin: "Manages the team, branding and all records.",
  member: "Adds, edits and deletes records.",
  viewer: "Can see everything but change nothing. Good for board members.",
};

interface OrganizationContextValue {
  organization: Organization | null;
  role: OrgRole | null;
  billing: Billing;
  branding: Branding;
  isLoading: boolean;
  error: string | null;
  /** Owners, admins and members, while the trial or subscription is active. */
  canEdit: boolean;
  /** Owners and admins. */
  isAdmin: boolean;
  isOwner: boolean;
  /** Reload membership, e.g. after accepting an invite or renaming the organization. */
  refresh: () => Promise<void>;
  /** Create an organization for a user who has none. Throws with a readable message on failure. */
  createOrganization: (name: string) => Promise<void>;
}

const OrganizationContext = createContext<OrganizationContextValue | null>(null);

// ===========================================================================
// Provider
// ===========================================================================

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [role, setRole] = useState<OrgRole | null>(null);
  const [billingDetails, setBillingDetails] = useState<OrganizationBilling | null>(null);
  const [branding, setBranding] = useState<Branding>({ primaryColor: null, logoUrl: null });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load the user's membership and organization in one request.
   * Security rules only return the user's own organization, so no extra
   * filtering is needed beyond user_id.
   *
   * silent: keep showing the current data while reloading. Without it the
   * gate swaps the whole app for a skeleton, unmounting the page that asked.
   */
  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!user) {
      setOrganization(null);
      setRole(null);
      setBillingDetails(null);
      setBranding({ primaryColor: null, logoUrl: null });
      setError(null);
      setIsLoading(false);
      return;
    }

    if (!silent) setIsLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from("organization_members")
        .select(
          "role, organization:organizations(id, name, billing:organization_billing(trial_ends_at, status, plan, current_period_end, cancel_at_period_end), settings:organization_settings(primary_color, logo_url))",
        )
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) throw new Error(fetchError.message);

      // Supabase types a to-one relation as an object; guard in case it comes back as an array.
      type SettingsRow = { primary_color: string | null; logo_url: string | null };
      type OrgRow = Organization & {
        billing: OrganizationBilling | OrganizationBilling[] | null;
        settings: SettingsRow | SettingsRow[] | null;
      };
      const row = data as { role: OrgRole; organization: OrgRow | OrgRow[] | null } | null;
      const org = Array.isArray(row?.organization) ? row?.organization[0] : row?.organization;
      const billingRow = Array.isArray(org?.billing) ? org?.billing[0] : org?.billing;
      const settingsRow = Array.isArray(org?.settings) ? org?.settings[0] : org?.settings;

      setOrganization(org ? { id: org.id, name: org.name } : null);
      setBillingDetails(billingRow ?? null);
      setBranding({ primaryColor: settingsRow?.primary_color ?? null, logoUrl: settingsRow?.logo_url ?? null });
      setRole(org ? (row?.role ?? null) : null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your organization.");
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  // Reload whenever the signed-in user changes. Keyed on id so token refreshes do not trigger reloads.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const refresh = useCallback(() => load({ silent: true }), [load]);

  // Theme the app with the organization's color; signing out restores the default.
  useEffect(() => {
    setBrandColor("organization", branding.primaryColor);
  }, [branding.primaryColor]);

  const createOrganization = useCallback(
    async (name: string) => {
      const { error: rpcError } = await supabase.rpc("create_organization", { p_name: name });
      if (rpcError) throw new Error(rpcError.message);
      await load();
    },
    [load],
  );

  const value = useMemo<OrganizationContextValue>(() => {
    const billing = describeBilling(billingDetails);
    return {
      organization,
      role,
      billing,
      branding,
      isLoading,
      error,
      canEdit: billing.hasAccess && (role === "owner" || role === "admin" || role === "member"),
      isAdmin: role === "owner" || role === "admin",
      isOwner: role === "owner",
      refresh,
      createOrganization,
    };
  }, [organization, role, billingDetails, branding, isLoading, error, refresh, createOrganization]);

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>;
}

// ===========================================================================
// Hook
// ===========================================================================

/** Access the current organization. Must be used inside <OrganizationProvider>. */
export function useOrganization(): OrganizationContextValue {
  const ctx = useContext(OrganizationContext);
  if (!ctx) throw new Error("useOrganization must be used inside <OrganizationProvider>.");
  return ctx;
}
