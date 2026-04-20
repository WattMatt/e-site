import React, { createContext, useContext, useEffect, useState } from 'react'
import { useRouter, useSegments } from 'expo-router'
import { Platform } from 'react-native'
import { Session } from '@supabase/supabase-js'
import * as Notifications from 'expo-notifications'
import { supabase } from '../lib/supabase'
import { authService } from '@esite/shared'

type Profile = {
  id: string
  email: string
  full_name: string
  phone: string | null
  avatar_url: string | null
}

type AuthContextValue = {
  session: Session | null
  profile: Profile | null
  isLoading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const segments = useSegments()
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Restore session on launch
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session) {
        loadProfile(session.user.id)
      } else {
        setIsLoading(false)
      }
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (session) {
        loadProfile(session.user.id)
      } else {
        setProfile(null)
        setIsLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId: string) {
    try {
      const data = await authService.getProfile(supabase, userId)
      setProfile(data as unknown as Profile)
      // Register push token after profile loads
      registerPushToken(userId).catch(() => {})
    } catch {
      // Profile not yet created — handle gracefully
    } finally {
      setIsLoading(false)
    }
  }

  async function registerPushToken(userId: string) {
    const { status } = await Notifications.requestPermissionsAsync()
    if (status !== 'granted') return
    // projectId is required for standalone builds; reads from EAS env var injected at build time
    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
    if (!token.data) return
    await (supabase as any).from('push_tokens').upsert(
      { user_id: userId, token: token.data, platform: Platform.OS as 'ios' | 'android', is_active: true },
      { onConflict: 'user_id,token' }
    )
  }

  // Redirect based on auth state + org membership
  useEffect(() => {
    if (isLoading) return
    const inAuthGroup = segments[0] === '(auth)'
    const inOnboarding = segments[0] === 'onboarding'

    if (!session && !inAuthGroup) {
      router.replace('/(auth)/login')
    } else if (session && inAuthGroup) {
      // Check org membership before sending to dashboard
      const memberships = (profile as any)?.user_organisations ?? []
      if (memberships.length === 0) {
        router.replace('/onboarding')
      } else {
        router.replace('/(tabs)/dashboard')
      }
    } else if (session && !inOnboarding) {
      const memberships = (profile as any)?.user_organisations ?? []
      if (memberships.length === 0 && !isLoading) {
        router.replace('/onboarding')
      }
    }
  }, [session, profile, segments, isLoading])

  const signIn = async (email: string, password: string) => {
    await authService.signIn(supabase, email, password)
  }

  const signUp = async (email: string, password: string, fullName: string) => {
    await authService.signUp(supabase, email, password, fullName)
  }

  const signOut = async () => {
    await authService.signOut(supabase)
    setSession(null)
    setProfile(null)
  }

  return (
    <AuthContext.Provider value={{ session, profile, isLoading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
