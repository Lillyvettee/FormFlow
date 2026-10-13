// ============================================================
// create-checkout
//
// Starts a Stripe Checkout for the caller's organization and returns its URL.
// Called from the Plan section in Settings.
//
// Body: { plan: "starter" | "mission", discountCode?: string }
//
// - Owners and admins only.
// - Free trial days left over (more than 2) carry into the subscription, so
//   subscribing early doesn't cost anyone their trial. Stripe needs a trial
//   end at least 48 hours away.
// - A demo code applies the 50%-off-forever coupon. The code is only marked
//   used once payment setup completes (see stripe-webhook), so abandoning
//   checkout doesn't waste it.
// ============================================================

import { admin, getBillingAdmin, json, priceIdForPlan, requireEnv, returnBaseUrl, serve, stripe, UserError } from "../_shared/billing.ts";

const MIN_TRIAL_SECONDS = 2 * 24 * 60 * 60;

serve(async (req) => {
  const caller = await getBillingAdmin(req);
  const { plan, discountCode } = await req.json().catch(() => ({}));

  const priceId = priceIdForPlan(plan);
  if (!priceId) throw new UserError("Choose Starter or Mission.");

  const { data: billing, error: billingError } = await admin
    .from("organization_billing")
    .select("*")
    .eq("organization_id", caller.organizationId)
    .single();
  if (billingError) throw billingError;

  if (billing.stripe_subscription_id && ["active", "trialing", "past_due"].includes(billing.status)) {
    throw new UserError("Your organization already has a subscription. Use Manage billing to change it.", 409);
  }

  // ----- Demo discount code -----
  let code: string | null = null;
  if (typeof discountCode === "string" && discountCode.trim()) {
    code = discountCode.trim().toUpperCase();
    const { data: row, error } = await admin.from("demo_codes").select("redeemed_at").eq("code", code).maybeSingle();
    if (error) throw error;
    if (!row) throw new UserError("That discount code isn't valid. Check it for typos.");
    if (row.redeemed_at) throw new UserError("That discount code has already been used.");
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

  const metadata = { organization_id: caller.organizationId, demo_code: code ?? "" };
  const base = returnBaseUrl(req);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: caller.organizationId,
    line_items: [{ price: priceId, quantity: 1 }],
    ...(code ? { discounts: [{ coupon: requireEnv("STRIPE_DEMO_COUPON_ID") }] } : {}),
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
