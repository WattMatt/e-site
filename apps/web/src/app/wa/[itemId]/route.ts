// apps/web/src/app/wa/[itemId]/route.ts
// The "Open in E-Site" URL button on every WhatsApp card points here, because a
// Meta template's URL base is fixed at approval time: https://www.e-site.live/wa/{{1}}.
// The lookup runs through the user's RLS, so an item they cannot see is
// indistinguishable from one that does not exist.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params
  const origin = new URL(req.url).origin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.redirect(`${origin}/login?next=${encodeURIComponent(`/wa/${itemId}`)}`)
  if (!UUID.test(itemId)) return NextResponse.redirect(`${origin}/dashboard`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any).schema('projects').from('work_items').select('project_id, ref').eq('id', itemId).maybeSingle()
  if (!data) return NextResponse.redirect(`${origin}/dashboard`)
  return NextResponse.redirect(`${origin}/projects/${data.project_id}/items/${encodeURIComponent(data.ref)}`)
}
