'use client'

import { createContext, useCallback, useContext, useEffect, useState, useTransition } from 'react'
import { setThemePreference } from '@/lib/theme/actions'
import type { ThemeMode } from '@/lib/theme/types'

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

export function ThemeProvider({
  initialMode,
  children,
}: {
  initialMode: ThemeMode
  children: React.ReactNode
}) {
  const [mode, setMode] = useState<ThemeMode>(initialMode)
  const [systemDark, setSystemDark] = useState(false)
  const [, startTransition] = useTransition()

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
    applyDataTheme(next)              // instant visual switch
    startTransition(() => { setThemePreference(next) })  // persist: cookie + DB
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
