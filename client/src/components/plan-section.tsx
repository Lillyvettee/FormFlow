/**
 * PlanSection
 *
 * The Plan card on the Settings page: trial or subscription status, the two
 * plans with "Choose" buttons, a field for a demo discount code, and a
 * "Manage billing" link to Stripe once subscribed.
 *
 * The code field is filled in automatically if this browser was used for
 * the demo (see DemoBanner).
 *
 * Only owners and admins can subscribe or manage billing (the Edge Functions
 * enforce this too). Everyone else sees the status and who to ask.
 *
 * After Stripe Checkout, people land on /settings?billing=success. The
 * subscription is recorded by the stripe-webhook function a moment later, so
 * this reloads the organization a few times until it shows up.
 */

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import { createBillingPortalSession, createCheckoutSession, type PaidPlan } from "@/lib/stripe";
import { DEMO_CODE_STORAGE_KEY } from "@/components/demo-banner";
import { Crown, Check, AlertCircle, ExternalLink } from "lucide-react";

/** Pricing shown here. Keep in sync with the Pricing section on the landing page and the Stripe prices. */
const PLANS: {
  id: PaidPlan;
  name: string;
  price: string;
  discountedPrice: string;
  billing: string;
  badge: string | null;
  features: string[];
}[] = [
  {
    id: "starter",
    name: "Starter",
    price: "$5",
    discountedPrice: "$2.50",
    billing: "Billed monthly",
    badge: null,
    features: ["Unlimited forms", "Impact reports", "Resource tracking"],
  },
  {
    id: "mission",
    name: "Mission",
    price: "$3",
    discountedPrice: "$1.50",
    billing: "Billed $36/year",
    badge: "Save 40%",
    features: ["Everything in Starter", "Priority support", "Custom branding"],
  },
];

const PLAN_NAMES: Record<PaidPlan, string> = { starter: "Starter", mission: "Mission" };

/** How many times, and how often, to check for the new subscription after checkout. */
const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 2000;

/** A code saved by DemoBanner when this browser was used for the demo. */
const savedDemoCode = (): string => {
  try {
    return localStorage.getItem(DEMO_CODE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

export function PlanSection() {
  const { toast } = useToast();
  const { billing, isAdmin, refresh } = useOrganization();
  const { details, isSubscribed, isOnTrial, trialDaysLeft, hasAccess } = billing;

  const [discountCode, setDiscountCode] = useState(savedDemoCode);
  /** The plan whose checkout is starting, or "portal". Disables the buttons meanwhile. */
  const [pending, setPending] = useState<PaidPlan | "portal" | null>(null);
  const [actionError, setActionError] = useState("");
  const [isConfirming, setIsConfirming] = useState(false);

  // Links to /settings#plan (e.g. from BillingBanner) arrive before this card
  // exists, so the browser can't scroll to it on its own.
  useEffect(() => {
    if (window.location.hash === "#plan") document.getElementById("plan")?.scrollIntoView();
  }, []);

  // ----- Returning from Stripe Checkout -----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("billing");
    if (!result) return;
    // Remove ?billing= so a refresh doesn't repeat this.
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);

    if (result === "canceled") {
      toast({ title: "Checkout canceled", description: "Nothing was charged." });
      return;
    }
    if (result !== "success") return;

    toast({ title: "Thank you!", description: "Your subscription is being set up." });
    setIsConfirming(true);
    let attempts = 0;
    const timer = setInterval(async () => {
      attempts += 1;
      await refresh();
      if (attempts >= POLL_ATTEMPTS) {
        clearInterval(timer);
        setIsConfirming(false);
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stop checking as soon as the subscription appears.
  useEffect(() => {
    if (isSubscribed) setIsConfirming(false);
  }, [isSubscribed]);

  // ----- Actions -----
  const goTo = async (action: PaidPlan | "portal") => {
    setPending(action);
    setActionError("");
    try {
      const { url } =
        action === "portal" ? await createBillingPortalSession() : await createCheckoutSession(action, discountCode);
      window.location.href = url;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Billing is unavailable right now. Please try again.");
      setPending(null);
    }
  };

  // ----- Status line -----
  let status: { text: string; tone: "default" | "warning" | "error" };
  if (isSubscribed && details?.plan) {
    const name = PLAN_NAMES[details.plan];
    const discount = details.discount_code ? " with your 50% demo discount" : "";
    if (details.status === "past_due") {
      status = { text: `${name} plan. Your last payment didn't go through; update your card to keep access.`, tone: "error" };
    } else if (details.cancel_at_period_end && details.current_period_end) {
      status = { text: `${name} plan${discount}, ending ${formatDate(details.current_period_end)}.`, tone: "warning" };
    } else if (details.status === "trialing") {
      status = { text: `${name} plan${discount}. Your free trial continues until ${formatDate(details.trial_ends_at)}; you won't be charged before then.`, tone: "default" };
    } else {
      status = { text: `${name} plan${discount}.${details.current_period_end ? ` Renews ${formatDate(details.current_period_end)}.` : ""}`, tone: "default" };
    }
  } else if (isOnTrial && details) {
    status = {
      text: `Free trial: ${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left (ends ${formatDate(details.trial_ends_at)}). Choose a plan any time; you won't be charged until the trial ends.`,
      tone: trialDaysLeft <= 7 ? "warning" : "default",
    };
  } else {
    status = { text: "Your free trial has ended, so your records are read-only. Choose a plan to keep adding and editing.", tone: "error" };
  }

  const toneClass = {
    default: "bg-muted text-foreground",
    warning: "bg-amber-500/10 text-amber-900 dark:text-amber-200",
    error: "bg-destructive/10 text-destructive",
  }[status.tone];

  return (
    <Card id="plan" className="p-6 scroll-mt-20">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Crown className="h-5 w-5 text-primary" aria-hidden="true" />
        </div>
        <div>
          <h2 className="font-semibold text-lg">Plan</h2>
          <p className="text-sm text-muted-foreground">Every organization starts with 30 days free, no card needed</p>
        </div>
      </div>

      <div className="space-y-5">
        <p role="status" className={`p-3 rounded-md text-sm ${toneClass}`}>
          {isConfirming ? "Confirming your subscription..." : status.text}
        </p>

        {actionError && (
          <div role="alert" className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            <span>{actionError}</span>
          </div>
        )}

        {/* ----- Already subscribed: manage in Stripe ----- */}
        {isSubscribed ? (
          isAdmin ? (
            <Button variant="outline" onClick={() => goTo("portal")} disabled={pending !== null}>
              {pending === "portal" ? "Opening..." : "Manage billing"}
              <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">Owners and admins can change the plan or payment details.</p>
          )
        ) : (
          <>
            {/* ----- Choose a plan ----- */}
            <div className="grid sm:grid-cols-2 gap-4">
              {PLANS.map((plan) => (
                <Card key={plan.id} className="p-5 flex flex-col" data-testid={`card-plan-${plan.id}`}>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold text-lg">{plan.name}</h3>
                    {plan.badge && <Badge variant="default">{plan.badge}</Badge>}
                  </div>
                  <p className="text-3xl font-bold mt-2">
                    {plan.price}
                    <span className="text-sm font-normal text-muted-foreground">/mo</span>
                  </p>
                  <p className="text-sm text-muted-foreground mt-2">{plan.billing}</p>
                  {discountCode.trim() && (
                    <p className="text-sm text-primary mt-1">{plan.discountedPrice}/mo with a valid demo code</p>
                  )}
                  <ul className="mt-4 mb-5 space-y-1.5 text-sm">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" /> {feature}
                      </li>
                    ))}
                  </ul>
                  {isAdmin && (
                    <Button
                      className="mt-auto"
                      variant={hasAccess ? "outline" : "default"}
                      onClick={() => goTo(plan.id)}
                      disabled={pending !== null}
                      data-testid={`button-choose-${plan.id}`}
                    >
                      {pending === plan.id ? "Opening checkout..." : `Choose ${plan.name}`}
                    </Button>
                  )}
                </Card>
              ))}
            </div>

            {isAdmin ? (
              <div className="space-y-2 max-w-sm">
                <Label htmlFor="discount-code">Demo discount code (optional)</Label>
                <Input
                  id="discount-code"
                  value={discountCode}
                  onChange={(e) => setDiscountCode(e.target.value.toUpperCase())}
                  placeholder="DEMO-XXXXXXXX"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={20}
                  aria-describedby="discount-code-help"
                />
                <p id="discount-code-help" className="text-xs text-muted-foreground">
                  From the demo. Takes 50% off for as long as you stay subscribed. Each code works once.
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Ask an owner or admin of your organization to choose a plan.</p>
            )}

            <p className="text-xs text-muted-foreground">
              Subscriptions renew automatically until canceled. See our{" "}
              <a href="/terms" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                Terms
              </a>{" "}
              and{" "}
              <a href="/refunds" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                Refund policy
              </a>
              .
            </p>
          </>
        )}
      </div>
    </Card>
  );
}
