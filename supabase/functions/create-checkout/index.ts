// ============================================================
// create-checkout
//
// Starts a Stripe Checkout for the caller's organization and returns its URL.
// Called from the Plan section in Settings.
//
// Body: { plan: "starter" | "mission", cycle: "monthly" | "yearly" }
//
// - Owners and admins only.
// - Free trial days left over (more than 2) carry into the subscription, so
//   subscribing early doesn't cost anyone their trial. Stripe needs a trial
//   end at least 48 hours away.
// - Checkout shows Stripe's "Add promotion code" box. Create codes in the
//   Stripe dashboard (Product catalog > Coupons); no app changes needed.
// ============================================================

import { admin, getBillingAdmin, json, priceIdForPlan, returnBaseUrl, serve, stripe, UserError } from "../_shared/billing.ts";

const MIN_TRIAL_SECONDS = 2 * 24 * 60 * 60;

serve(async (req) => {
  const caller = await getBillingAdmin(req);
  const { plan, cycle } = await req.json().catch(() => ({}));

  const priceId = priceIdForPlan(plan, cycle);
  if (!priceId) throw new UserError("Choose Starter or Mission, billed monthly or yearly.");

  const { data: billing, error: billingError } = await admin
    .from("organization_billing")
    .select("*")
    .eq("organization_id", caller.organizationId)
    .single();
  if (billingError) throw billingError;

  if (billing.stripe_subscription_id && ["active", "trialing", "past_due"].includes(billing.status)) {
    throw new UserError("Your organization already has a subscription. Use Manage billing to change it.", 409);
  }

  // ----- Stripe customer (one per organization) -----
  let customerId: string | null = billing.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: caller.email ?? undefined,
      name: caller.organizationName || undefined,
      metadata: { organization_id: caller.organizationId },
    });
    customerId = customer.id;
    const { error } = await admin
      .from("organization_billing")
      .update({ stripe_customer_id: customerId })
      .eq("organization_id", caller.organizationId);
    if (error) throw error;
  }

  // ----- Keep remaining trial days -----
  const trialEnd = Math.floor(new Date(billing.trial_ends_at).getTime() / 1000);
  const keepTrial = trialEnd - Date.now() / 1000 > MIN_TRIAL_SECONDS;

  const metadata = { organization_id: caller.organizationId };
  const base = returnBaseUrl(req);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: caller.organizationId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    // Card details are collected now even during a trial, so service continues without interruption.
    payment_method_collection: "always",
    subscription_data: {
      metadata,
      ...(keepTrial ? { trial_end: trialEnd } : {}),
    },
    metadata,
    success_url: `${base}/settings?billing=success`,
    cancel_url: `${base}/settings?billing=canceled`,
  });

  return json({ url: session.url });
});
