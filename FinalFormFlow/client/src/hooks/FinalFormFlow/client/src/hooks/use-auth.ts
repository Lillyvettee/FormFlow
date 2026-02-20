import { useState, useEffect, useCallback } from 'react'
import { User, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile, Subscription } from '@/types/database'

interface AuthState {
  user: User | null
  profile: Profile | null
  subscription: Subscription | null
  session: Session | null
  loading: boolean
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    profile: null,
    subscription: null,
    session: null,
    loading: true,
  })

  const fetchUserData = useCallback(async (userId: string) => {
    const [profileRes, subscriptionRes] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).single(),
      supabase.from('subscriptions').select('*').eq('user_id', userId).single(),
    ])

    return {
      profile: profileRes.data as Profile | null,
      subscription: subscriptionRes.data as Subscription | null,
    }
  }, [])

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session?.user) {
        const { profile, subscription } = await fetchUserData(session.user.id)
        setState({ user: session.user, profile, subscription, session, loading: false })
      } else {
        setState(s => ({ ...s, loading: false }))
      }
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (session?.user) {
        const { profile, subscription: sub } = await fetchUserData(session.user.id)
        setState({ user: session.user, profile, subscription: sub, session, loading: false })
      } else {
        setState({ user: null, profile: null, subscription: null, session: null, loading: false })
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchUserData])

  const signUp = async (email: string, password: string, fullName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    })
    return { data, error }
  }

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    return { data, error }
  }

  const signOut = async () => {
    const { error } = await supabase.auth.signOut()
    return { error }
  }

  const resetPassword = async (email: string) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    return { data, error }
  }

  const updatePassword = async (newPassword: string) => {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword })
    return { data, error }
  }

  const refreshProfile = async () => {
    if (!state.user) return
    const { profile, subscription } = await fetchUserData(state.user.id)
    setState(s => ({ ...s, profile, subscription }))
  }

  return {
    ...state,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    refreshProfile,
    isAuthenticated: !!state.user,
    plan: state.subscription?.plan ?? 'free',
  }
}
