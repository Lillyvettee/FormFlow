/**
 * PlanSection
 *
 * The Plan card on the Settings page: trial or subscription status, how much
 * of the plan's limits are used, the plans (monthly or yearly) with "Choose"
 * buttons and an Enterprise "Contact us", and a "Manage billing" link to
 * Stripe once subscribed. Promotion codes are entered on Stripe's checkout
 * page. Prices and limits come from lib/plans.
 *
 * Enterprise has no checkout: it is set up by hand after a sales
 * conversation (see the end of migration 016).
 *
 * Only owners and admins can subscribe or manage billing (the Edge Functions
 * enforce this too). Everyone else sees the status and who to ask.
 *
 * After Stripe Checkout, people land on /settings?billing=success. The
 * subscription is recorded by the stripe-webhook function a moment later, so
 * this reloads the organization a few times until it shows up.
 */

import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useOrganization } from "@/hooks/use-organization";
import { supabase } from "@/lib/supabase";
import { createBillingPortalSession, createCheckoutSession } from "@/lib/stripe";
import { BillingCycleToggle } from "@/components/billing-cycle-toggle";
import {
  PLANS,
  PLAN_ORDER,
  ENTERPRISE_CONTACT_PATH,
  billingLabel,
  formatDollars,
  formatLimit,
  monthlyEquivalent,
  type BillingCycle,
  type PaidPlan,
  type PlanLimits,
} from "@/lib/plans";
import { LEGAL } from "@/lib/legal";
import { Crown, Check, AlertCircle, ExternalLink } from "lucide-react";

/** get_plan_usage() in migration 016. */
interface PlanUsage {
  usage: Record<keyof PlanLimits, number>;
  limits: Record<keyof PlanLimits, number | null>;
}

const USAGE_ROWS: { key: keyof PlanLimits; label: string }[] = [
  { key: "forms", label: "Active forms" },
  { key: "members", label: "Team members and open invitations" },
  { key: "people", label: "Client profiles" },
  { key: "reports", label: "PDF reports this month" },
];

/** How many times, and how often, to check for the new subscription after checkout. */
const POLL_ATTEMPTS = 8;
const POLL_INTERVAL_MS = 2000;

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });

export function PlanSection() {
  const { toast } = useToast();
  const { billing, plan, isAdmin, refresh } = useOrganization();
  const { details, isSubscribed, isOnTrial, trialDaysLeft, hasAccess } = billing;
  const isEnterprise = isSubscribed && details?.plan === "enterprise";

  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [usage, setUsage] = useState<PlanUsage | null>(null);

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

  // ----- Usage -----
  // Reloads when the plan changes (e.g. right after subscribing).
  useEffect(() => {
    let cancelled = false;
    supabase.rpc("get_plan_usage").then(({ data, error }) => {
      if (!cancelled && !error && data) setUsage(data as PlanUsage);
    });
    return () => {
      cancelled = true;
    };
  }, [plan.id]);

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
        action === "portal" ? await createBillingPortalSession() : await createCheckoutSession(action, cycle);
      window.location.href = url;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Billing is unavailable right now. Please try again.");
      setPending(null);
    }
  };

  // ----- Status line -----
  let status: { text: string; tone: "default" | "warning" | "error" };
  if (isEnterprise) {
    status = { text: `Enterprise plan. To change it, email us at ${LEGAL.contactEmail}.`, tone: "default" };
  } else if (isSubscribed && details?.plan) {
    const name = PLANS[details.plan].name;
    if (details.status === "past_due") {
      status = { text: `${name} plan. Your last payment didn't go through; update your card to keep access.`, tone: "error" };
    } else if (details.cancel_at_period_end && details.current_period_end) {
      status = { text: `${name} plan, ending ${formatDate(details.current_period_end)}.`, tone: "warning" };
    } else if (details.status === "trialing") {
      status = { text: `${name} plan. Your free trial continues until ${formatDate(details.trial_ends_at)}; you won't be charged before then.`, tone: "default" };
    } else {
      status = { text: `${name} plan.${details.current_period_end ? ` Renews ${formatDate(details.current_period_end)}.` : ""}`, tone: "default" };
    }
  } else if (isOnTrial && details) {
    status = {
      text: `Free trial: ${trialDaysLeft} ${trialDaysLeft === 1 ? "day" : "days"} left (ends ${formatDate(details.trial_ends_at)}). You have Mission's limits until then. Choose a plan any time; you won't be charged until the trial ends.`,
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

        {/* ----- How much of the plan is used ----- */}
        {usage && (
          <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3" aria-label={`${plan.name} plan usage`}>
            {USAGE_ROWS.map(({ key, label }) => {
              const used = usage.usage[key];
              const limit = usage.limits[key];
              const full = limit !== null && used >= limit;
              return (
                <div key={key} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className={`font-medium tabular-nums ${full ? "text-destructive" : ""}`}>
                      {used.toLocaleString("en-US")} / {formatLimit(limit)}
                    </dd>
                  </div>
                  {limit !== null && (
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden="true">
                      <div
                        className={`h-full rounded-full ${full ? "bg-destructive" : "bg-primary"}`}
                        style={{ width: `${Math.min(100, (used / Math.max(limit, 1)) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </dl>
        )}

        {/* ----- Already subscribed: manage in Stripe ----- */}
        {isEnterprise ? null : isSubscribed ? (
          isAdmin ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => goTo("portal")} disabled={pending !== null}>
                {pending === "portal" ? "Opening..." : "Manage billing"}
                <ExternalLink className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
              <p className="text-sm text-muted-foreground">
                Switch plans or billing period in Manage billing. Need more?{" "}
                <Link href={ENTERPRISE_CONTACT_PATH} className="underline hover:text-foreground">
                  Ask about Enterprise
                </Link>
                .
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Owners and admins can change the plan or payment details.</p>
          )
        ) : (
          <>
            {/* ----- Choose a plan ----- */}
            <BillingCycleToggle value={cycle} onChange={setCycle} />
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {PLAN_ORDER.map((id) => {
                const option = PLANS[id];
                const perMonth = monthlyEquivalent(option, cycle);
                return (
                  <Card key={id} className="p-5 flex flex-col" data-testid={`card-plan-${id}`}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-lg">{option.name}</h3>
                      {id === "mission" && <Badge variant="default">Most popular</Badge>}
                    </div>
                    <p className="text-3xl font-bold mt-2">
                      {perMonth === null ? (
                        "Custom"
                      ) : (
                        <>
                          {formatDollars(perMonth)}
                          <span className="text-sm font-normal text-muted-foreground">/mo</span>
                        </>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground mt-2">{billingLabel(option, cycle)}</p>
                    <ul className="mt-4 mb-5 space-y-1.5 text-sm">
                      {option.highlights.map((feature) => (
                        <li key={feature} className="flex items-start gap-2">
                          <Check className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" aria-hidden="true" /> {feature}
                        </li>
                      ))}
                    </ul>
                    {id === "enterprise" ? (
                      <Link
                        href={ENTERPRISE_CONTACT_PATH}
                        className={buttonVariants({ variant: "outline", className: "mt-auto" })}
                        data-testid="button-contact-enterprise"
                      >
                        Contact us
                      </Link>
                    ) : (
                      isAdmin && (
                        <Button
                          className="mt-auto"
                          variant={hasAccess ? "outline" : "default"}
                          onClick={() => goTo(id)}
                          disabled={pending !== null}
                          data-testid={`button-choose-${id}`}
                        >
                          {pending === id ? "Opening checkout..." : `Choose ${option.name}`}
                        </Button>
                      )
                    )}
                  </Card>
                );
              })}
            </div>

            {isAdmin ? (
              <p className="text-sm text-muted-foreground">Have a promo code? You can enter it on the checkout page.</p>
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
