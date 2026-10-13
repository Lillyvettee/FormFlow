/**
 * DemoBanner
 *
 * A strip at the top of the app for demo visitors (anonymous users started
 * from /demo). Shows their personal half-off code and points them to
 * sign-up. Renders nothing for real accounts.
 *
 * The code comes from get_my_demo_code() (migration 004), which creates it
 * the first time. It works once, at checkout from Settings > Plan, and takes
 * 50% off for as long as that subscription lasts. It is also saved in this
 * browser, so the Plan section fills it in after the visitor signs up.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/lib/supabase";
import { Info, Copy, Check } from "lucide-react";

/** Remembered in this browser so Settings > Plan can fill it in after sign-up. */
export const DEMO_CODE_STORAGE_KEY = "formflow-demo-code";

export function DemoBanner() {
  const { user } = useAuth();
  const isDemo = Boolean(user?.is_anonymous);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isDemo) return;
    let cancelled = false;
    supabase.rpc("get_my_demo_code").then(({ data }) => {
      if (cancelled || typeof data !== "string") return;
      setCode(data);
      try {
        localStorage.setItem(DEMO_CODE_STORAGE_KEY, data);
      } catch {
        // Storage blocked (private window); the code is still shown to copy.
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isDemo, user?.id]);

  if (!isDemo) return null;

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked; the code is on screen to copy by hand.
    }
  };

  return (
    <div role="status" className="px-4 py-2 text-sm bg-primary/10 border-b shrink-0 text-center space-y-1">
      <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-2">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          You're trying HumMotion with a demo account.
        </span>
        <a href="/signup" className="font-medium text-primary underline underline-offset-4 hover:no-underline">
          Create a free account
        </a>
      </p>
      {code && (
        <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-muted-foreground">
          <span>
            Your code to lock in <strong className="text-foreground">50% off</strong>:
          </span>
          <code className="font-mono font-semibold text-foreground bg-background px-1.5 py-0.5 rounded">{code}</code>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={copy} aria-label="Copy discount code">
            {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            <span className="ml-1">{copied ? "Copied" : "Copy"}</span>
          </Button>
          <span>Enter it under Settings &gt; Plan after you sign up.</span>
        </p>
      )}
    </div>
  );
}
