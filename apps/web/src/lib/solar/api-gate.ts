/**
 * Route-handler twin of requireSolarLevel (access.ts). A redirect() from an API route becomes a
 * 307 the browser's fetch cannot act on, so API routes get JSON 401/403 instead. The level comes
 * from the same SQL helper the RLS policies use (public.solar_access_level).
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { solarLevelAllows, type SolarAccessLevel } from '@esite/shared'
import { getSolarAccessLevel } from './access'

type AnyClient = SupabaseClient<any, any, any>

export type SolarApiGate =
  | { ok: true; level: SolarAccessLevel; userId: string }
  | { ok: false; response: NextResponse }

export async function requireSolarLevelAPI(supabase: AnyClient, projectId: string, need: SolarAccessLevel): Promise<SolarApiGate> {
  const { data } = await supabase.auth.getUser()
  const user = data?.user ?? null
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  const level = await getSolarAccessLevel(projectId, supabase)
  if (!solarLevelAllows(level, need)) {
    return { ok: false, response: NextResponse.json({ error: 'Solar access required', need }, { status: 403 }) }
  }
  return { ok: true, level: level as SolarAccessLevel, userId: user.id }
}
