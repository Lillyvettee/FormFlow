// ============================================================
// stripe-webhook
//
// Stripe calls this when a checkout completes or a subscription changes.
// It keeps organization_billing in sync, marks demo codes as used, and emails
// NOTIFY_EMAIL when someone locks in the demo discount.
//
// Deploy with --no-verify-jwt: Stripe has no Supabase login, so every
// request is verified with the Stripe signature instead.
//
// Events to send (Stripe dashboard > Developers > Webhooks):
//   checkout.session.completed
//   customer.subscription.created
//   customer.subscription.updated
//   customer.subscription.deleted
//
// Retries: a failed request returns 500 and Stripe retries it for up to
// three days. Every step is safe to repeat; the email is sent once.
// ============================================================

import Stripe from "npm:stripe@17.7.0";
import { admin, json, planForPriceId, requireEnv, serve, stripe } from "../_shared/billing.ts";
import { sendEmail } from "../_shared/email.ts";

const cryptoProvider = Stripe.createSubtleCryptoProvider();

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing signature" }, 400);

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      await req.text(),
      signature,
      requireEnv("STRIPE_WEBHOOK_SECRET"),
      undefined,
      cryptoProvider,
    );
  } catch {
    return json({ error: "Invalid signature" }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription" || !session.subscription) break;
      const subscription = await stripe.subscriptions.retrieve(
        typeof session.subscription === "string" ? session.subscription : session.subscription.id,
      );
      await syncSubscription(subscription);

      const code = session.metadata?.demo_code;
      const organizationId = session.metadata?.organization_id;
      if (code && organizationId) await redeemDemoCode(code, organizationId, subscription, event.livemode);
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      break;
  }

  return json({ received: true });
});

// ------------------------------------------------------------
// Keep organization_billing in step with Stripe
// ------------------------------------------------------------

async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const item = subscription.items.data[0];
  // Newer Stripe API versions moved the period end onto each item.
  const periodEnd =
    (item as unknown as { current_period_end?: number })?.current_period_end ??
    (subscription as unknown as { current_period_end?: number }).current_period_end;

  const update = {
    status: subscription.status,
    plan: planForPriceId(item?.price.id),
    stripe_subscription_id: subscription.id,
    stripe_customer_id: customerId,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: subscription.cancel_at_period_end,
  };

  // The organization id is on the subscription; fall back to the customer for
  // subscriptions created outside our checkout (e.g. in the Stripe dashboard).
  const organizationId = subscription.metadata?.organization_id;
  const query = admin.from("organization_billing").update(update);
  const { error } = organizationId
    ? await query.eq("organization_id", organizationId)
    : await query.eq("stripe_customer_id", customerId);
  if (error) throw error;
}

// ------------------------------------------------------------
// Demo codes
// ------------------------------------------------------------

async function redeemDemoCode(code: string, organizationId: string, subscription: Stripe.Subscription, livemode: boolean) {
  // Claim the code. Does nothing if it is already claimed (e.g. a retry).
  const { error: claimError } = await admin
    .from("demo_codes")
    .update({ redeemed_at: new Date().toISOString(), redeemed_by_organization: organizationId })
    .eq("code", code)
    .is("redeemed_at", null);
  if (claimError) throw claimError;

  const { error: billingError } = await admin
    .from("organization_billing")
    .update({ discount_code: code })
    .eq("organization_id", organizationId);
  if (billingError) throw billingError;

  // Email once, and only for the organization that actually claimed the code.
  const { data: row, error } = await admin
    .from("demo_codes")
    .select("redeemed_by_organization, notified_at")
    .eq("code", code)
    .single();
  if (error) throw error;
  if (row.redeemed_by_organization !== organizationId || row.notified_at) return;

  await sendLockInEmail(code, organizationId, subscription, livemode);

  const { error: notifiedError } = await admin
    .from("demo_codes")
    .update({ notified_at: new Date().toISOString() })
    .eq("code", code);
  if (notifiedError) throw notifiedError;
}

async function sendLockInEmail(code: string, organizationId: string, subscription: Stripe.Subscription, livemode: boolean) {
  const { data: org } = await admin.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  const customer = await stripe.customers.retrieve(
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id,
  );
  const email = "deleted" in customer && customer.deleted ? "unknown" : (customer.email ?? "unknown");

  const price = subscription.items.data[0]?.price;
  const plan = planForPriceId(price?.id);
  const interval = price?.recurring?.interval ?? "period";
  const fullPrice = (price?.unit_amount ?? 0) / 100;
  const dashboardUrl = `https://dashboard.stripe.com/${livemode ? "" : "test/"}subscriptions/${subscription.id}`;

  const text = [
    `${org?.name ?? "An organization"} just locked in the demo discount.`,
    "",
    `Contact:   ${email}`,
    `Plan:      ${plan === "mission" ? "Mission" : plan === "starter" ? "Starter" : "Unknown"}`,
    `Price:     $${(fullPrice / 2).toFixed(2)}/${interval} (half of $${fullPrice.toFixed(2)})`,
    `Code:      ${code}`,
    `Status:    ${subscription.status === "trialing" ? "In free trial, first charge at trial end" : subscription.status}`,
    livemode ? "" : "Test mode: no real money was charged.",
    "",
    `View in Stripe: ${dashboardUrl}`,
  ].join("\n");

  // Throws on failure, which makes Stripe retry and the email go out later.
  await sendEmail({
    to: [requireEnv("NOTIFY_EMAIL")],
    subject: `${livemode ? "" : "[Test] "}${org?.name ?? "Someone"} locked in 50% off`,
    text,
  });
}
