/**
 * MDB 2021 local-municipality boundaries for the area-of-supply map (E7).
 * Signed-in callers only, and only while the map flag is on (the licence
 * question is the owner's: lib/tariffs/map-flag.ts). Served from the server
 * bundle, never from /public, so it is not downloadable while the flag is off.
 * Boundaries: Municipal Demarcation Board, simplified (docs/tariffs/mdb-boundaries-source.json).
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { tariffMapEnabled } from '@/lib/tariffs/map-flag'
import boundaries from '@/lib/tariffs/geo/za-local-municipalities-2021.json'

export const dynamic = 'force-dynamic'

export async function GET() {
  if (!tariffMapEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Sign in to view the map.' }, { status: 401 })
  return NextResponse.json(boundaries, { headers: { 'Cache-Control': 'private, max-age=86400' } })
}
