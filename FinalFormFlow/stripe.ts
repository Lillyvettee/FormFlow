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
// Calls a Supabase Edge Function to create a Stripe Checkout session
// Deploy the edge function from: supabase/functions/create-checkout/
// ============================================================
export async function createCheckoutSession(plan: Plan, billingCycle: BillingCycle): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke('create-checkout', {
    body: { plan, billingCycle },
  })

  if (error) throw new Error(error.message)
  if (!data?.url) throw new Error('No checkout URL returned')

  return { url: data.url }
}

// Redirect to Stripe Billing Portal to manage/cancel subscription
export async function createBillingPortalSession(): Promise<{ url: string }> {
  const { data, error } = await supabase.functions.invoke('create-portal', {
    body: {},
  })

  if (error) throw new Error(error.message)
  if (!data?.url) throw new Error('No portal URL returned')

  return { url: data.url }
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
