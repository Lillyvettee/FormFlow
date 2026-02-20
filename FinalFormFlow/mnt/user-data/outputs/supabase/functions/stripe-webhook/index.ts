// ============================================================
// Supabase Edge Function: stripe-webhook
// Deploy with: supabase functions deploy stripe-webhook
//
// In Stripe Dashboard → Webhooks, add endpoint:
//   https://<your-project>.supabase.co/functions/v1/stripe-webhook
//
// Events to listen for:
//   - customer.subscription.created
//   - customer.subscription.updated
//   - customer.subscription.deleted
//   - invoice.payment_failed
//
// Set secret:
//   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
// ============================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
})

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (req: Request) => {
  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response('No signature', { status: 400 })
  }

  const body = await req.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!,
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return new Response('Invalid signature', { status: 400 })
  }

  console.log(`Processing event: ${event.type}`)

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionChange(subscription)
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        await handleSubscriptionDeleted(subscription)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        await handlePaymentFailed(invoice)
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('Error processing webhook:', err)
    return new Response('Webhook processing failed', { status: 500 })
  }
})

async function handleSubscriptionChange(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.supabase_user_id
  if (!userId) {
    console.error('No supabase_user_id in subscription metadata')
    return
  }

  const plan = subscription.metadata?.plan ?? 'free'
  const billingCycle = subscription.metadata?.billing_cycle ?? 'monthly'

  const { error } = await supabase
    .from('subscriptions')
    .update({
      stripe_subscription_id: subscription.id,
      plan,
      billing_cycle: billingCycle,
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      cancel_at_period_end: subscription.cancel_at_period_end,
    })
    .eq('user_id', userId)

  if (error) {
    console.error('Error updating subscription:', error)
    throw error
  }

  console.log(`Updated subscription for user ${userId} to plan ${plan}`)
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  const userId = subscription.metadata?.supabase_user_id
  if (!userId) return

  const { error } = await supabase
    .from('subscriptions')
    .update({
      plan: 'free',
      billing_cycle: null,
      status: 'canceled',
      stripe_subscription_id: null,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
    })
    .eq('user_id', userId)

  if (error) {
    console.error('Error reverting subscription to free:', error)
    throw error
  }

  console.log(`Reverted user ${userId} to free plan`)
}

async function handlePaymentFailed(invoice: Stripe.Invoice) {
  if (!invoice.subscription) return

  const subscription = await stripe.subscriptions.retrieve(invoice.subscription as string)
  const userId = subscription.metadata?.supabase_user_id
  if (!userId) return

  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'past_due' })
    .eq('user_id', userId)

  if (error) {
    console.error('Error marking subscription as past_due:', error)
    throw error
  }

  console.log(`Marked subscription as past_due for user ${userId}`)
}
