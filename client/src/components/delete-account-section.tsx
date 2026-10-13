/**
 * DeleteAccountSection
 *
 * The "Delete account" card at the bottom of Settings.
 *
 * Deleting is two steps, so a stray click or an unattended laptop can't
 * remove an account:
 *   1. Here: confirm in a dialog, then we email a one-time link
 *      (request-account-deletion function).
 *   2. The link opens /delete-account, which shows exactly what will be
 *      deleted and does it on confirmation (confirm-account-deletion).
 *
 * Hidden for demo visitors, who have no email and are cleaned up anyway.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/use-auth";
import { callFunction } from "@/lib/functions";
import { Trash2, AlertCircle, MailCheck } from "lucide-react";

export function DeleteAccountSection() {
  const { user } = useAuth();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  /** Where the confirmation link was sent, once it has been. */
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (!user || user.is_anonymous) return null;

  const requestDeletion = async (e: React.MouseEvent) => {
    e.preventDefault(); // keep the dialog open until finished
    setIsSending(true);
    setError("");
    try {
      const { email } = await callFunction<{ email: string }>(
        "request-account-deletion",
        {},
        "Couldn't send the confirmation email. Please try again.",
      );
      setSentTo(email);
      setIsDialogOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the confirmation email. Please try again.");
      setIsDialogOpen(false);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Card className="p-6 border-destructive/30">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-md bg-destructive/10 flex items-center justify-center shrink-0">
          <Trash2 className="h-5 w-5 text-destructive" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-semibold text-lg">Delete account</h2>
          <p className="text-sm text-muted-foreground">Permanently remove your account. This can't be undone.</p>
        </div>
      </div>

      <div className="space-y-4">
        {error && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {sentTo ? (
          <div role="status" className="flex items-start gap-2 p-3 rounded-md bg-muted text-sm">
            <MailCheck className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              We sent a confirmation link to <strong className="break-all">{sentTo}</strong>. Open it within 24 hours to
              finish deleting your account. Until then, nothing changes.
            </span>
          </div>
        ) : (
          <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setIsDialogOpen(true)}>
            Delete my account
          </Button>
        )}
      </div>

      <AlertDialog open={isDialogOpen} onOpenChange={(open) => !isSending && setIsDialogOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your account?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>We'll email you a link to confirm. Your account is deleted only after you open it.</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    If you're the <strong className="text-foreground">only member</strong> of your organization, it's
                    deleted too, with all of its records and files, and any subscription is canceled.
                  </li>
                  <li>
                    If you're on a <strong className="text-foreground">team</strong>, you leave it and the records you
                    created stay with your team. The only owner must make someone else an owner first.
                  </li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={requestDeletion}
              disabled={isSending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isSending ? "Sending..." : "Email me a confirmation link"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
