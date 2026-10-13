// ============================================================
// FormFlow - Stripe Integration
// Uses Supabase Edge Functions for server-side Stripe calls
// ============================================================

import { supabase } from '@/lib/supabase'
import { PLAN_CONFIG, type Plan, type BillingCycle } from '@/types/database'

// ============================================================
// PLAN LIMIT ENFORCEMENT (client-side checks)
// ============================================================
export function getPlanLimits(plan: Plan) {
  return PLAN_CONFIG[plan].limits
}

export function canCreateForm(plan: Plan, currentFormCount: number): boolean {
  const limit = PLAN_CONFIG[plan].limits.forms
  return limit === Infinity || currentFormCount < limit
}

export function canReceiveResponse(plan: Plan, responsesThisMonth: number): boolean {
  const limit = PLAN_CONFIG[plan].limits.responsesPerMonth
  return limit === Infinity || responsesThisMonth < limit
}

export function canAddTeamMember(plan: Plan, currentSeatCount: number): boolean {
  return currentSeatCount < PLAN_CONFIG[plan].limits.seats
}

export function isFeatureAvailable(plan: Plan, feature: 'customBranding' | 'fileUploads' | 'csvExport' | 'prioritySupport'): boolean {
  const featureMap: Record<string, Plan[]> = {
    customBranding: ['mission'],
    fileUploads: ['starter', 'mission'],
    csvExport: ['starter', 'mission'],
    prioritySupport: ['mission'],
  }
  return featureMap[feature]?.includes(plan) ?? false
}

// ============================================================
// STRIPE CHECKOUT
// Calls the Supabase Edge Functions in supabase/functions/
// (create-checkout, create-portal). Billing belongs to the organization;
// only owners and admins can use these.
// ============================================================

/** Paid plans. Starter is billed monthly, Mission yearly. */
export type PaidPlan = 'starter' | 'mission'

/**
 * Calls an Edge Function and returns its { url }. Functions report problems
 * as { error: "message" } with a non-2xx status; supabase-js hides that body
 * behind a generic message, so it is read back out here.
 */
async function invokeForUrl(name: string, body: object): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke(name, { body })

  if (error) {
    const message = await error.context?.json?.().then((b: { error?: string }) => b?.error).catch(() => null)
    throw new Error(message || 'Billing is unavailable right now. Please try again.')
  }
  if (!data?.url) throw new Error('Billing is unavailable right now. Please try again.')

  return { url: data.url }
}

/** Start Stripe Checkout. A demo discount code, if given, is checked on the server. */
export function createCheckoutSession(plan: PaidPlan, discountCode?: string): Promise<{ url: string }> {
  return invokeForUrl('create-checkout', { plan, discountCode: discountCode?.trim() || undefined })
}

/** Stripe's billing portal: update card, invoices, switch plan, cancel. */
export function createBillingPortalSession(): Promise<{ url: string }> {
  return invokeForUrl('create-portal', {})
}

// ============================================================
// PRICING DISPLAY HELPERS
// ============================================================
export function formatPrice(cents: number): string {
  if (cents === 0) return 'Free'
  return `$${(cents / 100).toFixed(0)}/mo`
}

export function getYearlyMonthlyEquivalent(yearlyPriceCents: number): string {
  if (yearlyPriceCents === 0) return 'Free'
  return `$${(yearlyPriceCents / 100 / 12).toFixed(2)}/mo`
}

export function getPlanDisplayInfo(plan: Plan, billingCycle: BillingCycle = 'monthly') {
  const config = PLAN_CONFIG[plan]
  const isYearly = billingCycle === 'yearly'

  return {
    name: config.name,
    description: config.description,
    price: isYearly ? config.yearlyPrice : config.monthlyPrice,
    displayPrice: isYearly
      ? getYearlyMonthlyEquivalent(config.yearlyPrice)
      : formatPrice(config.monthlyPrice),
    yearlyDiscount: config.yearlyDiscount,
    features: config.features,
    limits: config.limits,
    billingLabel: isYearly ? 'billed annually' : 'billed monthly',
  }
}
