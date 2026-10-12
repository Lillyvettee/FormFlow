/**
 * use-organization
 *
 * Provides the signed-in user's organization and role to the whole app.
 * Place at: client/src/hooks/use-organization.tsx (next to use-auth).
 *
 * Usage:
 *   const { organization, role, canEdit, isAdmin } = useOrganization();
 *
 *   canEdit   true for owners, admins and members. Use it to hide add, edit
 *             and delete buttons from viewers.
 *   isAdmin   true for owners and admins. Use it for team and settings controls.
 *
 * These flags only control what the UI shows. The database security rules
 * enforce the same permissions, so hiding a button is a convenience, not
 * the protection.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/use-auth";

// ===========================================================================
// Types and role metadata
// ===========================================================================

export type OrgRole = "owner" | "admin" | "member" | "viewer";

export interface Organization {
  id: string;
  name: string;
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
  isLoading: boolean;
  error: string | null;
  /** Owners, admins and members. */
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Load the user's membership and organization in one request.
   * Security rules only return the user's own organization, so no extra
   * filtering is needed beyond user_id.
   */
  const load = useCallback(async () => {
    if (!user) {
      setOrganization(null);
      setRole(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error: fetchError } = await supabase
        .from("organization_members")
        .select("role, organization:organizations(id, name)")
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchError) throw new Error(fetchError.message);

      // Supabase types a to-one relation as an object; guard in case it comes back as an array.
      const row = data as { role: OrgRole; organization: Organization | Organization[] | null } | null;
      const org = Array.isArray(row?.organization) ? row?.organization[0] : row?.organization;

      setOrganization(org ?? null);
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

  const createOrganization = useCallback(
    async (name: string) => {
      const { error: rpcError } = await supabase.rpc("create_organization", { p_name: name });
      if (rpcError) throw new Error(rpcError.message);
      await load();
    },
    [load],
  );

  const value = useMemo<OrganizationContextValue>(
    () => ({
      organization,
      role,
      isLoading,
      error,
      canEdit: role === "owner" || role === "admin" || role === "member",
      isAdmin: role === "owner" || role === "admin",
      isOwner: role === "owner",
      refresh: load,
      createOrganization,
    }),
    [organization, role, isLoading, error, load, createOrganization],
  );

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
