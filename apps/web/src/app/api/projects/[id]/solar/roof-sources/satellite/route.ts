/**
 * POST /api/projects/[id]/solar/roof-sources/satellite — capture a north-up
 * satellite picture of the site as a roof source (functional spec §3.2 C,
 * decision D-08: Mapbox, server-side, no html2canvas).
 *
 * app/api/* sits OUTSIDE (admin)/layout.tsx, so this route gates itself.
 * Order: token (503, before the session, so an unconfigured server is obvious
 * and cheap) → session (401) → Solar Edit (403) → rate limit (429) → site
 * location (409) → Mapbox (502) → service-role upload under <org>/<project>/ →
 * roof source row written through the CALLER's session so 00211's RLS and bind
 * trigger decide. A refused row removes its orphaned image.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getSolarAccessLevel } from '@/lib/solar/access'
import { rateLimit } from '@/lib/rate-limit'
import { recordSolarAudit } from '@/lib/solar/audit'
import { humanLayoutError } from '@/lib/solar/layout-errors'
import {
  MAPBOX_ATTRIBUTION, SATELLITE_CAPTURE, clampSatelliteZoom, mapboxStaticUrl, metresPerPixel, solarLevelAllows,
} from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_BYTES = 20 * 1024 * 1024
const BUCKET = 'solar-roof-images'
const MAPBOX_TIMEOUT_MS = 15_000

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const token = process.env.MAPBOX_ACCESS_TOKEN
  if (!token) return NextResponse.json({ error: 'Satellite capture is not configured' }, { status: 503 })
  const { id: projectId } = await ctx.params
  if (!UUID.test(projectId)) return NextResponse.json({ error: 'Unknown project' }, { status: 400 })

  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'You are not signed in.' }, { status: 401 })
  const level = await getSolarAccessLevel(projectId, supabase)
  if (!solarLevelAllows(level, 'edit')) return NextResponse.json({ error: 'You do not have Solar edit access on this project.' }, { status: 403 })
  if (!rateLimit(`solar-satellite:${user.id}`, 5, 60_000)) return NextResponse.json({ error: 'Too many captures — wait a minute.' }, { status: 429 })

  let body: { zoom?: unknown }
  try { body = (await req.json()) as { zoom?: unknown } } catch { body = {} }
  const zoom = clampSatelliteZoom(Number(body.zoom ?? SATELLITE_CAPTURE.defaultZoom) || SATELLITE_CAPTURE.defaultZoom)

  const { data: study } = await supabase.schema('solar').from('studies')
    .select('id, organisation_id, latitude, longitude').eq('project_id', projectId).maybeSingle()
  const s = study as { id: string; organisation_id: string; latitude: number | string | null; longitude: number | string | null } | null
  const lat = s?.latitude == null ? null : Number(s.latitude)
  const lng = s?.longitude == null ? null : Number(s.longitude)
  if (!s || lat === null || lng === null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'Set the site location in Site & Supply first.' }, { status: 409 })
  }

  let bytes: Uint8Array
  let contentType: string
  // Bounded: a hung upstream must not hold the function open. (AbortController +
  // timer rather than AbortSignal.timeout, which not every runtime provides.)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), MAPBOX_TIMEOUT_MS)
  try {
    const res = await fetch(mapboxStaticUrl({ lat, lng, zoom, token }), { cache: 'no-store', signal: ac.signal })
    contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || !/^image\/(png|jpeg)/.test(contentType)) {
      // The URL carries the token — never log it.
      console.error('[solar-satellite] mapbox refused', { status: res.status })
      return NextResponse.json({ error: 'The satellite service did not answer — try again.' }, { status: 502 })
    }
    bytes = new Uint8Array(await res.arrayBuffer())
  } catch {
    return NextResponse.json({ error: 'The satellite service did not answer — try again.' }, { status: 502 })
  } finally {
    clearTimeout(timer)
  }
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return NextResponse.json({ error: 'The satellite service did not answer — try again.' }, { status: 502 })
  }

  const ext = contentType.includes('png') ? 'png' : 'jpg'
  const path = `${s.organisation_id}/${projectId}/satellite-${Date.now()}.${ext}`
  const service = createServiceClient() as unknown as AnyClient
  const { error: upErr } = await service.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false })
  if (upErr) return NextResponse.json({ error: 'Could not store the image — try again.' }, { status: 500 })

  const { data, error } = await supabase.schema('solar').from('roof_sources').insert({
    study_id: s.id,
    kind: 'satellite',
    storage_path: path,
    m_per_px: metresPerPixel(lat, zoom, SATELLITE_CAPTURE.retina),
    attribution: MAPBOX_ATTRIBUTION,
    capture_meta: { lat, lng, zoom, width: SATELLITE_CAPTURE.pixelSize, height: SATELLITE_CAPTURE.pixelSize, style: SATELLITE_CAPTURE.style },
  }).select('id')
  const id = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (error || !id) {
    await service.storage.from(BUCKET).remove([path])
    return NextResponse.json({ error: humanLayoutError(error) }, { status: error?.code === '42501' ? 403 : 400 })
  }
  await recordSolarAudit({ projectId, actorId: user.id, verb: 'roof_source_satellite_captured', objectRef: { roofSourceId: id, zoom } })
  return NextResponse.json({ roofSourceId: id }, { status: 201 })
}
