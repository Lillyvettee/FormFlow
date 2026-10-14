/**
 * BillingBanner
 *
 * A strip at the top of the app about the organization's trial or payment:
 *   - Free trial:      days left (stronger in the last 7 days)
 *   - Trial ended:     records are read-only until someone subscribes
 *   - Payment failed:  update the card
 * Renders nothing once subscribed, and nothing for anonymous guest users.
 */

import { useAuth } from "@/hooks/use-auth";
import { useOrganization } from "@/hooks/use-organization";
import { Clock, Lock, AlertCircle, type LucideIcon } from "lucide-react";

export function BillingBanner() {
  const { user } = useAuth();
  const { billing, isAdmin } = useOrganization();
  const { details, isSubscribed, isOnTrial, trialDaysLeft } = billing;

  if (user?.is_anonymous || !details) return null;

  let message: string;
  let Icon: LucideIcon;
  let toneClass: string;

  if (isSubscribed) {
    if (details.status !== "past_due") return null;
    message = "Your last payment didn't go through.";
    Icon = AlertCircle;
    toneClass = "bg-destructive/10 text-destructive";
  } else if (isOnTrial) {
    message = `${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left in your free trial.`;
    Icon = Clock;
    toneClass = trialDaysLeft <= 7 ? "bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-muted text-muted-foreground";
  } else {
    message = "Your free trial has ended, so your records are read-only.";
    Icon = Lock;
    toneClass = "bg-destructive/10 text-destructive";
  }

  return (
    <div
      role="status"
      className={`flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm border-b shrink-0 ${toneClass}`}
    >
      <span className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
        {message}
      </span>
      {isAdmin ? (
        <a href="/settings#plan" className="font-medium underline underline-offset-4 hover:no-underline">
          {isSubscribed ? "Update payment" : "Choose a plan"}
        </a>
      ) : (
        <span>Ask an owner or admin to {isSubscribed ? "update the payment details" : "choose a plan"}.</span>
      )}
    </div>
  );
}
