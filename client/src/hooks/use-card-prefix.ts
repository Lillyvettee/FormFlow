/**
 * use-card-prefix
 *
 * The organization's ID card settings:
 *   prefix  organizations.card_prefix (migration 022), e.g. "FB" in
 *           "FB-000123"; owners and admins change it with set_card_prefix
 *   design  organizations.card_design (migration 023), normalized with
 *           defaults; owners and admins change it with set_card_design
 */

import { useCallback, useEffect, useState } from "react";
import { useOrganization } from "@/hooks/use-organization";
import { supabase } from "@/lib/supabase";
import { normalizeCardDesign, type CardDesign } from "@/lib/card-design";

export function useCardPrefix() {
  const { organization, branding } = useOrganization();
  const [prefix, setPrefix] = useState<string | null>(null);
  const [rawDesign, setRawDesign] = useState<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!organization) return;
    let cancelled = false;
    // "*" so this still works before migration 023 adds card_design.
    supabase
      .from("organizations")
      .select("*")
      .eq("id", organization.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const row = data as { card_prefix?: string | null; card_design?: unknown } | null;
        setPrefix(row?.card_prefix ?? null);
        setRawDesign(row?.card_design ?? null);
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organization]);

  const design: CardDesign = normalizeCardDesign(rawDesign, branding.primaryColor);

  /** Throws with a readable message if it's refused. */
  const save = useCallback(async (next: string) => {
    const { data, error } = await supabase.rpc("set_card_prefix", { p_prefix: next });
    if (error) throw new Error(error.message);
    setPrefix((data as string | null) ?? null);
  }, []);

  /** Throws with a readable message if it's refused. */
  const saveDesign = useCallback(async (next: CardDesign) => {
    const { error } = await supabase.rpc("set_card_design", { p_design: next });
    if (error) throw new Error(error.message);
    setRawDesign(next);
  }, []);

  return { prefix, design, isLoading, save, saveDesign };
}
