'use server'

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { parseThemeMode } from './resolve'
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type ThemeMode } from './types'

/**
 * Persist the user's theme choice. Always writes the cookie (the SSR source
 * of truth); also writes profiles.theme_preference when authenticated so the
 * choice follows the user across devices. RLS restricts the update to the
 * caller's own row.
 */
export async function setThemePreference(mode: ThemeMode): Promise<void> {
  const safe = parseThemeMode(mode)

  const cookieStore = await cookies()
  cookieStore.set(THEME_COOKIE, safe, {
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: 'lax',
  })

  // DB sync is best-effort: the cookie above already makes the choice stick on
  // this device, so a failed profile write must not break theme switching.
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').update({ theme_preference: safe }).eq('id', user.id)
    }
  } catch (err) {
    console.error('setThemePreference: profile update failed', err)
  }
}
