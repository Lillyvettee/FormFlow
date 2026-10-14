/**
 * Who in an organization can see People (migration 015): people, help given,
 * case notes, and responses sent through personal links.
 *
 *   everyone  every member, including viewers
 *   editors   owners, admins and members (the default)
 *   admins    owners and admins only
 *
 * The database enforces this; the app uses it to hide the People page and
 * explain why. Before migration 015 there's no setting, and everyone sees
 * People as before.
 */

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useOrganization, type OrgRole } from "@/hooks/use-organization";

export type PeopleAccess = "everyone" | "editors" | "admins";

export const PEOPLE_ACCESS_OPTIONS: { value: PeopleAccess; label: string; description: string }[] = [
  { value: "editors", label: "Owners, admins and members", description: "Viewers can't see People." },
  { value: "admins", label: "Owners and admins only", description: "Members and viewers can't see People." },
  { value: "everyone", label: "Everyone on the team", description: "Including viewers." },
];

export const canRoleViewPeople = (role: OrgRole | null, access: PeopleAccess): boolean =>
  role === "owner" || role === "admin" || (role === "member" && access !== "admins") || (role === "viewer" && access === "everyone");

export function usePeopleAccess() {
  const { organization, role } = useOrganization();
  const [access, setAccess] = useState<PeopleAccess>("editors");
  const [isLoading, setIsLoading] = useState(true);
  const [isAvailable, setIsAvailable] = useState(true);

  const load = useCallback(async () => {
    if (!organization) return;
    const { data, error } = await supabase.from("organizations").select("people_access").eq("id", organization.id).maybeSingle();
    if (error) {
      // Column missing (migration 015 not run): behave as before.
      setIsAvailable(false);
      setAccess("everyone");
    } else {
      setIsAvailable(true);
      setAccess(((data as { people_access?: PeopleAccess } | null)?.people_access ?? "editors") as PeopleAccess);
    }
    setIsLoading(false);
  }, [organization]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async (next: PeopleAccess) => {
    if (!organization) return;
    const { error } = await supabase.from("organizations").update({ people_access: next }).eq("id", organization.id);
    if (error) throw error;
    setAccess(next);
  };

  return { access, canView: canRoleViewPeople(role, access), isLoading, isAvailable, save };
}
