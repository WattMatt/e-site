import 'server-only'
/**
 * Platform tariff library gate (D-03). Asks public.is_platform_tariff_admin()
 * (00209: an explicit allow-list, service-role writes only) — the same
 * question the tariffs.* write policies ask. Fails closed. Pages 404 for
 * non-admins so the route is not advertised; actions return a sentence;
 * API routes return JSON 401/404.
 */
import { notFound, redirect } from 'next/navigation'
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyClient = SupabaseClient<any, any, any>

export const NOT_PERMITTED = 'You do not have permission to do that.'

export async function isPlatformTariffAdmin(supabase: AnyClient): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_tariff_admin')
  return !error && data === true
}

export async function requirePlatformTariffAdminPage(): Promise<{ supabase: AnyClient; userId: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (!(await isPlatformTariffAdmin(supabase))) notFound()
  return { supabase, userId: user.id }
}

export type AdminGate = { ok: true; supabase: AnyClient; userId: string } | { ok: false; error: string }

export async function requirePlatformTariffAdmin(): Promise<AdminGate> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !(await isPlatformTariffAdmin(supabase))) return { ok: false, error: NOT_PERMITTED }
  return { ok: true, supabase, userId: user.id }
}

export async function requirePlatformTariffAdminAPI(): Promise<
  { ok: true; supabase: AnyClient; userId: string } | { ok: false; response: NextResponse }
> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'Not authenticated' }, { status: 401 }) }
  if (!(await isPlatformTariffAdmin(supabase))) return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  return { ok: true, supabase, userId: user.id }
}
