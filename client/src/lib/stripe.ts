// ============================================================
// HumMotion - Stripe Integration
// Uses Supabase Edge Functions for server-side Stripe calls
// ============================================================

import { callFunction } from '@/lib/functions'
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

const BILLING_UNAVAILABLE = 'Billing is unavailable right now. Please try again.'

/** Calls a billing Edge Function and returns its { url }. */
async function invokeForUrl(name: string, body: object): Promise<{ url: string }> {
  const data = await callFunction<{ url?: string }>(name, body, BILLING_UNAVAILABLE)
  if (!data?.url) throw new Error(BILLING_UNAVAILABLE)
  return { url: data.url }
}

/** Start Stripe Checkout. Promotion codes are entered on Stripe's checkout page. */
export function createCheckoutSession(plan: PaidPlan): Promise<{ url: string }> {
  return invokeForUrl('create-checkout', { plan })
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
