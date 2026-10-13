/**
 * DeleteAccountPage
 *
 * Where the "Confirm deleting your account" email link lands:
 * /delete-account?token=... (a full-page route; works signed in or out).
 *
 *   1. Checks the link and shows exactly what will happen, e.g. that the
 *      organization will be deleted too (confirm-account-deletion, preview).
 *   2. "Permanently delete my account" deletes it, signs this browser out
 *      and shows a final screen.
 *
 * Expired, used or replaced links show an explanation instead.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { supabase } from "@/lib/supabase";
import { callFunction } from "@/lib/functions";
import { AlertCircle, CheckCircle2, Trash2 } from "lucide-react";

const tokenFromUrl = () => new URLSearchParams(window.location.search).get("token") ?? "";

export default function DeleteAccountPage() {
  const [token] = useState(tokenFromUrl);
  const [preview, setPreview] = useState<{ email: string | null; summary: string } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleted, setDeleted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    callFunction<{ email: string | null; summary: string }>("confirm-account-deletion", { token }, "Couldn't check this link. Refresh to try again.")
      .then((data) => !cancelled && setPreview(data))
      .catch((err) => !cancelled && setLoadError(err instanceof Error ? err.message : "Couldn't check this link."));
    return () => {
      cancelled = true;
    };
  }, [token]);

  const confirmDeletion = async () => {
    setIsDeleting(true);
    setDeleteError("");
    try {
      await callFunction("confirm-account-deletion", { token, confirm: true }, "Couldn't delete your account. Please try again.");
      // The account no longer exists; clear this browser's session without calling the server.
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      setDeleted(true);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete your account. Please try again.");
      setIsDeleting(false);
    }
  };

  return (
    <div className="relative min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>

      <Card className="w-full max-w-md p-8 space-y-5 text-center">
        {deleted ? (
          <div role="status" className="space-y-4">
            <CheckCircle2 className="h-10 w-10 text-chart-2 mx-auto" aria-hidden="true" />
            <h1 className="text-xl font-serif font-bold">Your account has been deleted</h1>
            <p className="text-sm text-muted-foreground">We've emailed you a confirmation. Thank you for using HumMotion.</p>
            <Button asChild variant="outline">
              <a href="/">Back to home</a>
            </Button>
          </div>
        ) : loadError ? (
          <div className="space-y-4">
            <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto" aria-hidden="true" />
            <h1 className="text-xl font-serif font-bold">This link can't be used</h1>
            <p className="text-sm text-muted-foreground">{loadError}</p>
            <Button asChild variant="outline">
              <a href="/settings">Go to Settings</a>
            </Button>
          </div>
        ) : !preview ? (
          <div className="space-y-3" aria-busy="true">
            <Skeleton className="h-10 w-10 rounded-full mx-auto" />
            <Skeleton className="h-6 w-56 mx-auto" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </div>
        ) : (
          <div className="space-y-5">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto" aria-hidden="true">
              <Trash2 className="h-6 w-6 text-destructive" />
            </div>
            <div className="space-y-2">
              <h1 className="text-xl font-serif font-bold">Delete your account?</h1>
              {preview.email && (
                <p className="text-sm text-muted-foreground">
                  Account: <strong className="text-foreground break-all">{preview.email}</strong>
                </p>
              )}
            </div>
            <p className="text-sm text-left p-3 rounded-md bg-destructive/10">{preview.summary}</p>
            <p className="text-sm text-muted-foreground">This is permanent and can't be undone.</p>

            {deleteError && (
              <p role="alert" className="text-sm text-destructive">
                {deleteError}
              </p>
            )}

            <div className="flex flex-col gap-2">
              <Button
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={confirmDeletion}
                disabled={isDeleting}
              >
                {isDeleting ? "Deleting..." : "Permanently delete my account"}
              </Button>
              <Button asChild variant="outline" disabled={isDeleting}>
                <a href="/">Keep my account</a>
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
