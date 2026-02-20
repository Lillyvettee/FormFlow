// ============================================================
// Supabase Edge Function: create-checkout
// Deploy with: supabase functions deploy create-checkout
//
// Set these secrets in Supabase dashboard or via CLI:
//   supabase secrets set STRIPE_SECRET_KEY=sk_live_...
//   supabase secrets set STRIPE_STARTER_MONTHLY_PRICE_ID=price_...
//   supabase secrets set STRIPE_STARTER_YEARLY_PRICE_ID=price_...
//   supabase secrets set STRIPE_MISSION_MONTHLY_PRICE_ID=price_...
//   supabase secrets set STRIPE_MISSION_YEARLY_PRICE_ID=price_...
//   supabase secrets set APP_URL=https://yourapp.vercel.app
// ============================================================

import Stripe from 'https://esm.sh/stripe@14.21.0?target=deno'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2024-06-20',
})

const PRICE_IDS: Record<string, Record<string, string>> = {
  starter: {
    monthly: Deno.env.get('STRIPE_STARTER_MONTHLY_PRICE_ID')!,
    yearly: Deno.env.get('STRIPE_STARTER_YEARLY_PRICE_ID')!,
  },
  mission: {
    monthly: Deno.env.get('STRIPE_MISSION_MONTHLY_PRICE_ID')!,
    yearly: Deno.env.get('STRIPE_MISSION_YEARLY_PRICE_ID')!,
  },
}

Deno.serve(async (req: Request) => {
  // CORS headers
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  try {
    // Authenticate user via Supabase JWT
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header')

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) throw new Error('Unauthorized')

    const { plan, billingCycle } = await req.json()

    if (!PRICE_IDS[plan]?.[billingCycle]) {
      throw new Error(`Invalid plan (${plan}) or billing cycle (${billingCycle})`)
    }

    // Get or create Stripe customer
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .single()

    let customerId = subscription?.stripe_customer_id

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      })
      customerId = customer.id

      await supabase
        .from('subscriptions')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', user.id)
    }

    const appUrl = Deno.env.get('APP_URL')!

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: PRICE_IDS[plan][billingCycle], quantity: 1 }],
      success_url: `${appUrl}/settings?checkout=success`,
      cancel_url: `${appUrl}/settings?checkout=canceled`,
      metadata: {
        supabase_user_id: user.id,
        plan,
        billing_cycle: billingCycle,
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id,
          plan,
          billing_cycle: billingCycle,
        },
      },
    })

    return new Response(JSON.stringify({ url: session.url }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
})
