// ============================================================
// HumMotion - Stripe Integration
// Uses Supabase Edge Functions for server-side Stripe calls.
// Prices, limits and features are in lib/plans.ts.
// ============================================================

import { callFunction } from '@/lib/functions'
import type { BillingCycle, PaidPlan } from '@/lib/plans'

// ============================================================
// STRIPE CHECKOUT
// Calls the Supabase Edge Functions in supabase/functions/
// (create-checkout, create-portal). Billing belongs to the organization;
// only owners and admins can use these.
// ============================================================

export type { PaidPlan, BillingCycle }

const BILLING_UNAVAILABLE = 'Billing is unavailable right now. Please try again.'

/** Calls a billing Edge Function and returns its { url }. */
async function invokeForUrl(name: string, body: object): Promise<{ url: string }> {
  const data = await callFunction<{ url?: string }>(name, body, BILLING_UNAVAILABLE)
  if (!data?.url) throw new Error(BILLING_UNAVAILABLE)
  return { url: data.url }
}

/** Start Stripe Checkout. Promotion codes are entered on Stripe's checkout page. */
export function createCheckoutSession(plan: PaidPlan, cycle: BillingCycle): Promise<{ url: string }> {
  return invokeForUrl('create-checkout', { plan, cycle })
}

/** Stripe's billing portal: update card, invoices, switch plan, cancel. */
export function createBillingPortalSession(): Promise<{ url: string }> {
  return invokeForUrl('create-portal', {})
}
