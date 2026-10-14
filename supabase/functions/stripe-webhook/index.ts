// ============================================================
// stripe-webhook
//
// Stripe calls this when a checkout completes or a subscription changes.
// It keeps organization_billing in sync.
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
// three days. Every step is safe to repeat.
// ============================================================

import Stripe from "npm:stripe@17.7.0";
import { admin, json, planForPriceId, requireEnv, serve, stripe } from "../_shared/billing.ts";

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
