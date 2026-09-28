// apps/web/src/app/api/projects/[id]/solar/site-load/rebuild/route.ts
/**
 * POST /api/projects/[id]/solar/site-load/rebuild — rebuild the study's site series, streaming
 * progress as NDJSON (functional spec §4.5 "Server job; shows progress"). Gate: Solar Edit.
 * app/api/* is outside (admin)/layout.tsx, so this route gates itself.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { rebuildSiteLoad } from '@/lib/solar/load/site-load-service'
import { loadErrorMessage } from '@/lib/solar/load/messages'
import type { RebuildEvent } from '@/lib/solar/load/view-types'

export const runtime = 'nodejs'
export const maxDuration = 300
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'edit')
  if (!gate.ok) return gate.response

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder()
      const emit = (e: RebuildEvent) => controller.enqueue(enc.encode(JSON.stringify(e) + '\n'))
      try {
        await rebuildSiteLoad(supabase, projectId, gate.userId, emit)
      } catch (err) {
        console.error('[solar/site-load/rebuild]', { projectId, error: err instanceof Error ? err.message : String(err) })
        emit({ type: 'error', code: 'rebuild_failed', message: loadErrorMessage('rebuild_failed') })
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { status: 200, headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } })
}
