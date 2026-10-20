/**
 * use-is-staff
 *
 * Whether the signed-in user is HumMotion staff (is_staff(), migration 017):
 * their confirmed email is in staff_admins. Shows the Inbox link in the
 * sidebar and lets /admin load. The database rules are what actually keep
 * everyone else out of the inbox.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";

export function useIsStaff(): { isStaff: boolean; isLoading: boolean } {
  const { user } = useAuth();
  const [state, setState] = useState({ isStaff: false, isLoading: true });

  useEffect(() => {
    if (!user || user.is_anonymous) {
      setState({ isStaff: false, isLoading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, isLoading: true }));
    supabase.rpc("is_staff").then(({ data, error }) => {
      // Before migration 017 the function doesn't exist; treat that as "not staff".
      if (!cancelled) setState({ isStaff: !error && data === true, isLoading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.is_anonymous]);

  return state;
}
