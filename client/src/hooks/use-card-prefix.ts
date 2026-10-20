/**
 * use-card-prefix
 *
 * The organization's ID card prefix (organizations.card_prefix, migration
 * 022), e.g. "FB" in "FB-000123", and a way for owners and admins to change
 * it (set_card_prefix).
 */

import { useCallback, useEffect, useState } from "react";
import { useOrganization } from "@/hooks/use-organization";
import { supabase } from "@/lib/supabase";

export function useCardPrefix() {
  const { organization } = useOrganization();
  const [prefix, setPrefix] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!organization) return;
    let cancelled = false;
    supabase
      .from("organizations")
      .select("card_prefix")
      .eq("id", organization.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setPrefix((data as { card_prefix?: string | null } | null)?.card_prefix ?? null);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organization]);

  /** Throws with a readable message if it's refused. */
  const save = useCallback(async (next: string) => {
    const { data, error } = await supabase.rpc("set_card_prefix", { p_prefix: next });
    if (error) throw new Error(error.message);
    setPrefix((data as string | null) ?? null);
  }, []);

  return { prefix, isLoading, save };
}
