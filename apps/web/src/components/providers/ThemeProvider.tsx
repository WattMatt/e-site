'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type ThemeMode } from '@/lib/theme/types'

interface ThemeContextValue {
  /** The user's chosen mode. */
  mode: ThemeMode
  /** The concrete theme in effect ('light' | 'dark'), resolving 'system' via the OS. */
  resolvedTheme: 'light' | 'dark'
  setTheme: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/** Apply (or clear) the data-theme attribute. 'system' clears it so CSS media queries apply. */
function applyDataTheme(mode: ThemeMode) {
  const el = document.documentElement
  if (mode === 'system') el.removeAttribute('data-theme')
  else el.setAttribute('data-theme', mode)
}

/**
 * Persist the choice. The cookie is the SSR source of truth (read by the root
 * layout); the profile write is best-effort and RLS-scoped to the user's own
 * row. Done client-side (matching ProfileSettingsForm) to keep server-only
 * modules out of this client bundle.
 */
function persist(mode: ThemeMode) {
  document.cookie = `${THEME_COOKIE}=${mode}; path=/; max-age=${THEME_COOKIE_MAX_AGE}; samesite=lax`
  try {
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        return supabase.from('profiles').update({ theme_preference: mode }).eq('id', user.id)
      }
    })
  } catch {
    // Cookie already set above — DB sync is best-effort.
  }
}

export function ThemeProvider({
  initialMode,
  children,
}: {
  initialMode: ThemeMode
  children: React.ReactNode
}) {
  const [mode, setMode] = useState<ThemeMode>(initialMode)
  const [systemDark, setSystemDark] = useState(false)

  // Track the OS preference so resolvedTheme is correct for UI in 'system' mode,
  // and so a live OS flip updates dependent UI (CSS itself reacts via media query).
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setTheme = useCallback((next: ThemeMode) => {
    setMode(next)
    applyDataTheme(next)  // instant visual switch
    persist(next)         // cookie (SSR) + profile (cross-device)
  }, [])

  const resolvedTheme: 'light' | 'dark' =
    mode === 'system' ? (systemDark ? 'dark' : 'light') : mode

  return (
    <ThemeContext.Provider value={{ mode, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider')
  return ctx
}
