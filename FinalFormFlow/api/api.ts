// ============================================================
// FormFlow - API Layer
// Replaces all Flask/Express API routes with Supabase calls
// ============================================================

import { supabase } from '@/lib/supabase'
import type {
  Form, InsertForm, UpdateForm,
  FormSubmission,
  Link, InsertLink, UpdateLink,
  InventoryItem, InsertInventoryItem, UpdateInventoryItem,
  OrganizationSettings, UpdateOrganizationSettings,
  Profile, TeamMember, TeamRole,
} from '@/types/database'

// ============================================================
// HELPERS
// ============================================================
function throwOnError<T>(data: T | null, error: unknown): T {
  if (error) throw error
  if (data === null) throw new Error('No data returned')
  return data
}

// ============================================================
// FORMS
// ============================================================
export const formsApi = {
  list: async (userId: string): Promise<Form[]> => {
    const { data, error } = await supabase
      .from('forms')
      .select('*')
      .eq('user_id', userId)
      .eq('is_archived', false)
      .order('created_at', { ascending: false })
    return throwOnError(data, error)
  },

  get: async (formId: string): Promise<Form> => {
    const { data, error } = await supabase
      .from('forms')
      .select('*')
      .eq('id', formId)
      .single()
    return throwOnError(data, error)
  },

  create: async (form: InsertForm): Promise<Form> => {
    const { data, error } = await supabase
      .from('forms')
      .insert(form)
      .select()
      .single()
    return throwOnError(data, error)
  },

  update: async (formId: string, updates: UpdateForm): Promise<Form> => {
    const { data, error } = await supabase
      .from('forms')
      .update(updates)
      .eq('id', formId)
      .select()
      .single()
    return throwOnError(data, error)
  },

  delete: async (formId: string): Promise<void> => {
    const { error } = await supabase
      .from('forms')
      .delete()
      .eq('id', formId)
    if (error) throw error
  },

  archive: async (formId: string): Promise<void> => {
    const { error } = await supabase
      .from('forms')
      .update({ is_archived: true })
      .eq('id', formId)
    if (error) throw error
  },

  publish: async (formId: string, published: boolean): Promise<Form> => {
    const { data, error } = await supabase
      .from('forms')
      .update({ is_published: published })
      .eq('id', formId)
      .select()
      .single()
    return throwOnError(data, error)
  },
}

// ============================================================
// FORM SUBMISSIONS
// ============================================================
export const submissionsApi = {
  list: async (formId: string): Promise<FormSubmission[]> => {
    const { data, error } = await supabase
      .from('form_submissions')
      .select('*')
      .eq('form_id', formId)
      .order('submitted_at', { ascending: false })
    return throwOnError(data, error)
  },

  // Public submit — no auth required (used by form respondents)
  submit: async (formId: string, submissionData: Record<string, unknown>, email?: string): Promise<FormSubmission> => {
    const { data, error } = await supabase
      .from('form_submissions')
      .insert({
        form_id: formId,
        data: submissionData,
        respondent_email: email ?? null,
      })
      .select()
      .single()
    return throwOnError(data, error)
  },

  delete: async (submissionId: string): Promise<void> => {
    const { error } = await supabase
      .from('form_submissions')
      .delete()
      .eq('id', submissionId)
    if (error) throw error
  },

  // Get count for a form (for plan limit enforcement)
  countThisMonth: async (userId: string): Promise<number> => {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const { count, error } = await supabase
      .from('form_submissions')
      .select('id', { count: 'exact', head: true })
      .gte('submitted_at', startOfMonth.toISOString())
      // join through forms to filter by user
      .in('form_id', (await supabase.from('forms').select('id').eq('user_id', userId)).data?.map(f => f.id) ?? [])

    if (error) throw error
    return count ?? 0
  },
}

// ============================================================
// LINKS
// ============================================================
export const linksApi = {
  list: async (userId: string): Promise<Link[]> => {
    const { data, error } = await supabase
      .from('links')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    return throwOnError(data, error)
  },

  create: async (link: InsertLink): Promise<Link> => {
    const { data, error } = await supabase
      .from('links')
      .insert(link)
      .select()
      .single()
    return throwOnError(data, error)
  },

  update: async (linkId: string, updates: UpdateLink): Promise<Link> => {
    const { data, error } = await supabase
      .from('links')
      .update(updates)
      .eq('id', linkId)
      .select()
      .single()
    return throwOnError(data, error)
  },

  delete: async (linkId: string): Promise<void> => {
    const { error } = await supabase.from('links').delete().eq('id', linkId)
    if (error) throw error
  },
}

// ============================================================
// INVENTORY
// ============================================================
export const inventoryApi = {
  list: async (userId: string): Promise<InventoryItem[]> => {
    const { data, error } = await supabase
      .from('inventory_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    return throwOnError(data, error)
  },

  create: async (item: InsertInventoryItem): Promise<InventoryItem> => {
    const { data, error } = await supabase
      .from('inventory_items')
      .insert(item)
      .select()
      .single()
    return throwOnError(data, error)
  },

  update: async (itemId: string, updates: UpdateInventoryItem): Promise<InventoryItem> => {
    const { data, error } = await supabase
      .from('inventory_items')
      .update(updates)
      .eq('id', itemId)
      .select()
      .single()
    return throwOnError(data, error)
  },

  delete: async (itemId: string): Promise<void> => {
    const { error } = await supabase.from('inventory_items').delete().eq('id', itemId)
    if (error) throw error
  },
}

// ============================================================
// ORGANIZATION SETTINGS
// ============================================================
export const settingsApi = {
  get: async (userId: string): Promise<OrganizationSettings> => {
    const { data, error } = await supabase
      .from('organization_settings')
      .select('*')
      .eq('user_id', userId)
      .single()
    return throwOnError(data, error)
  },

  update: async (userId: string, updates: UpdateOrganizationSettings): Promise<OrganizationSettings> => {
    const { data, error } = await supabase
      .from('organization_settings')
      .update(updates)
      .eq('user_id', userId)
      .select()
      .single()
    return throwOnError(data, error)
  },
}

// ============================================================
// PROFILE
// ============================================================
export const profileApi = {
  get: async (userId: string): Promise<Profile> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single()
    return throwOnError(data, error)
  },

  update: async (userId: string, updates: Partial<Pick<Profile, 'full_name' | 'organization_name' | 'avatar_url'>>): Promise<Profile> => {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', userId)
      .select()
      .single()
    return throwOnError(data, error)
  },
}

// ============================================================
// TEAM MEMBERS
// ============================================================
export const teamApi = {
  list: async (ownerId: string): Promise<TeamMember[]> => {
    const { data, error } = await supabase
      .from('team_members')
      .select('*')
      .eq('owner_id', ownerId)
      .order('invited_at', { ascending: false })
    return throwOnError(data, error)
  },

  invite: async (ownerId: string, email: string, role: TeamRole = 'member'): Promise<TeamMember> => {
    const { data, error } = await supabase
      .from('team_members')
      .insert({ owner_id: ownerId, email, role })
      .select()
      .single()
    return throwOnError(data, error)
  },

  updateRole: async (memberId: string, role: TeamRole): Promise<TeamMember> => {
    const { data, error } = await supabase
      .from('team_members')
      .update({ role })
      .eq('id', memberId)
      .select()
      .single()
    return throwOnError(data, error)
  },

  remove: async (memberId: string): Promise<void> => {
    const { error } = await supabase.from('team_members').delete().eq('id', memberId)
    if (error) throw error
  },
}
