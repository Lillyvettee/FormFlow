// ============================================================
// HumMotion - Database Types
// Keep in sync with supabase/migrations/001_initial_schema.sql
// ============================================================

export type Plan = 'free' | 'starter' | 'mission'
export type BillingCycle = 'monthly' | 'yearly'
export type SubscriptionStatus = 'active' | 'canceled' | 'past_due' | 'trialing'
export type TeamRole = 'admin' | 'member' | 'viewer'
export type TeamMemberStatus = 'pending' | 'active'
export type ItemCondition = 'new' | 'good' | 'fair' | 'poor'

// ============================================================
// PLAN CONFIG
// Update prices/limits here — they flow through the entire app
// ============================================================
export const PLAN_CONFIG = {
  free: {
    name: 'Free',
    description: 'Get started at no cost',
    monthlyPrice: 0,
    yearlyPrice: 0,
    yearlyDiscount: 0,
    limits: {
      forms: 3,           // TODO: Set your limit
      responsesPerMonth: 100, // TODO: Set your limit
      seats: 1,
    },
    features: [
      'Up to 3 forms',
      '100 responses/month',
      '1 seat',
      'Basic reporting',
    ],
  },
  starter: {
    name: 'Starter',
    description: 'For growing non-profits',
    monthlyPrice: 0,      // TODO: Set price (e.g. 1500 = $15.00)
    yearlyPrice: 0,       // TODO: Set yearly price
    yearlyDiscount: 0,    // TODO: Set discount percentage (e.g. 20)
    stripeMonthlyPriceId: 'price_TODO_starter_monthly',
    stripeYearlyPriceId: 'price_TODO_starter_yearly',
    limits: {
      forms: 15,          // TODO: Set your limit
      responsesPerMonth: 1000, // TODO: Set your limit
      seats: 3,           // TODO: Set your limit
    },
    features: [
      'Up to 15 forms',
      '1,000 responses/month',
      '3 seats',
      'Advanced reporting',
      'CSV export',
      'Email notifications',
    ],
  },
  mission: {
    name: 'Mission',
    description: 'For established non-profits',
    monthlyPrice: 0,      // TODO: Set price
    yearlyPrice: 0,       // TODO: Set yearly price
    yearlyDiscount: 0,    // TODO: Set discount percentage
    stripeMonthlyPriceId: 'price_TODO_mission_monthly',
    stripeYearlyPriceId: 'price_TODO_mission_yearly',
    limits: {
      forms: Infinity,
      responsesPerMonth: Infinity,
      seats: 10,
    },
    features: [
      'Unlimited forms',
      'Unlimited responses',
      '10 seats',
      'Custom branding',
      'Priority support',
      'Impact reports',
      'All Starter features',
    ],
  },
} as const

// ============================================================
// DATABASE ROW TYPES
// ============================================================
export interface Profile {
  id: string
  email: string
  full_name: string | null
  organization_name: string | null
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface Subscription {
  id: string
  user_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  plan: Plan
  billing_cycle: BillingCycle | null
  status: SubscriptionStatus
  current_period_start: string | null
  current_period_end: string | null
  cancel_at_period_end: boolean
  created_at: string
  updated_at: string
}

// Form field types
export type FieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'radio'
  | 'file'
  | 'image' // photo upload
  | 'audio' // voice memo
  | 'section'

export interface FormField {
  id: string
  type: FieldType
  label: string
  placeholder?: string
  required: boolean
  options?: string[] // for select, multiselect, radio, checkbox
  validation?: {
    min?: number
    max?: number
    pattern?: string
  }
  helpText?: string
  /**
   * Marks a number or dropdown question as an outcome, compared between each
   * person's first and latest check-in (migration 010). Dropdown answers score
   * by position: the first option is 1.
   */
  outcome?: { betterWhen: 'higher' | 'lower' }
}

export interface FormSettings {
  submitButtonText?: string
  successMessage?: string
  notificationEmail?: string
  allowMultipleSubmissions?: boolean
  /** The form's own look; unset values fall back to the organization's branding. See lib/form-appearance.ts. */
  theme?: {
    primaryColor?: string
    backgroundColor?: string
    logoUrl?: string
  }
}

export interface Form {
  id: string
  user_id: string
  title: string
  description: string | null
  fields: FormField[]
  settings: FormSettings
  is_published: boolean
  is_archived: boolean
  response_count: number
  created_at: string
  updated_at: string
}

export interface FormSubmission {
  id: string
  form_id: string
  data: Record<string, unknown>
  respondent_email: string | null
  ip_address: string | null
  submitted_at: string
  /** The person this response came from, via their personal link (migration 010). */
  person_id?: string | null
}

/** Someone the organization serves (migration 010). */
export interface Person {
  id: string
  organization_id: string
  full_name: string
  email: string | null
  phone: string | null
  program: string | null
  status: 'active' | 'completed' | 'inactive'
  start_date: string
  notes: string | null
  /** Secret part of their personal form links; changing it turns old links off. */
  access_token: string
  created_at: string
  /** Set when the organization splits names (migration 011). */
  first_name?: string | null
  last_name?: string | null
  /** Values of the organization's own fields (migration 011). */
  custom?: Record<string, unknown>
}

export interface Link {
  id: string
  user_id: string
  title: string
  url: string
  description: string | null
  category: string | null
  created_at: string
  updated_at: string
}

export interface InventoryItem {
  id: string
  user_id: string
  name: string
  description: string | null
  quantity: number
  unit: string | null
  category: string | null
  condition: ItemCondition | null
  location: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface OrganizationSettings {
  id: string
  user_id: string
  organization_name: string | null
  logo_url: string | null
  primary_color: string
  contact_email: string | null
  website: string | null
  mission_statement: string | null
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  owner_id: string
  member_id: string | null
  email: string
  role: TeamRole
  status: TeamMemberStatus
  invited_at: string
  joined_at: string | null
}

// ============================================================
// INSERT TYPES (omit auto-generated fields)
// ============================================================
export type InsertForm = Omit<Form, 'id' | 'response_count' | 'created_at' | 'updated_at'>
export type UpdateForm = Partial<Omit<Form, 'id' | 'user_id' | 'created_at' | 'updated_at'>>

export type InsertLink = Omit<Link, 'id' | 'created_at' | 'updated_at'>
export type UpdateLink = Partial<Omit<Link, 'id' | 'user_id' | 'created_at' | 'updated_at'>>

export type InsertInventoryItem = Omit<InventoryItem, 'id' | 'created_at' | 'updated_at'>
export type UpdateInventoryItem = Partial<Omit<InventoryItem, 'id' | 'user_id' | 'created_at' | 'updated_at'>>

export type UpdateOrganizationSettings = Partial<Omit<OrganizationSettings, 'id' | 'user_id' | 'created_at' | 'updated_at'>>
