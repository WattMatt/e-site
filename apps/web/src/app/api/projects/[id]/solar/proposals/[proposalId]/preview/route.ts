/**
 * GET preview of a DRAFT proposal (spec §9.3 Preview PDF): same snapshot builder as Issue, rendered
 * with a PREVIEW watermark, nothing stored. Sits outside (admin)/layout.tsx, so it gates itself.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { rateLimit } from '@/lib/rate-limit'
import { prepareProposalSnapshot } from '@/lib/solar/proposals/prepare'
import { loadSolarBrandingData } from '@/lib/solar/reports/branding-loader'
import { solarBranding } from '@/lib/solar/reports/branding'
import { renderProposalPdf } from '@/lib/solar/reports/render-proposal'

export const runtime = 'nodejs'
export const maxDuration = 60
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; proposalId: string }> }) {
  const { id, proposalId } = await params
  if (!UUID.test(id) || !UUID.test(proposalId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireSolarLevelAPI(supabase, id, 'edit_financials')
  if (!gate.ok) return gate.response
  if (!rateLimit(`solar-preview:${gate.userId}`, 20, 60_000)) return NextResponse.json({ error: 'Too many previews — wait a minute.' }, { status: 429 })
  const { data } = await supabase.schema('solar').from('proposals')
    .select('id, project_id, family_id, version, status, case_id, draft').eq('id', proposalId).eq('project_id', id).maybeSingle()
  const p = data as { id: string; family_id: string; version: number; status: string; case_id: string | null; draft: unknown } | null
  if (!p) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  if (p.status !== 'draft') return NextResponse.json({ error: 'This proposal has been issued — open its PDF from the list.' }, { status: 409 })
  const svc = createServiceClient() as unknown as AnyClient
  const { data: prof } = await svc.from('profiles').select('full_name, email').eq('id', gate.userId).maybeSingle()
  const actor = { id: gate.userId, name: ((prof as { full_name?: string } | null)?.full_name ?? '').trim() || 'Your proposer', email: (prof as { email?: string } | null)?.email ?? null }
  const prepared = await prepareProposalSnapshot({ user: supabase, svc, projectId: id, proposal: p, actor, issuedAt: new Date() })
  if (!prepared.ok) return NextResponse.json({ error: prepared.error, ...(prepared.fieldErrors ? { fieldErrors: prepared.fieldErrors } : {}) }, { status: 422 })
  const { branding } = solarBranding(await loadSolarBrandingData(svc, id), { title: 'Solar PV proposal', kicker: 'PROPOSAL', date: new Date().toISOString().slice(0, 10) })
  const pdf = await renderProposalPdf(prepared.snapshot, branding, { preview: true })
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="proposal-v${p.version}-preview.pdf"`, 'cache-control': 'no-store' },
  })
}
