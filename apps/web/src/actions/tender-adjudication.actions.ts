'use server'

import { revalidatePath } from 'next/cache'
import { gateTender } from '@/lib/tender/gate'

type Result<T> = { data: T } | { error: string }

/** issued → closed, once the closing time has passed (the database refuses earlier). */
export async function closeTenderAction(tenderId: string): Promise<Result<true>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'issued') return { error: 'Only an issued tender can be closed' }
  if (!g.tender.closing_at || new Date(g.tender.closing_at) > new Date()) return { error: 'The closing time has not passed yet.' }
  const { data, error } = await g.supabase.schema('projects').from('tenders').update({ status: 'closed' }).eq('id', tenderId).eq('status', 'issued').select('id')
  if (error) return { error: error.code === '55000' ? 'The closing time has not passed yet.' : 'Could not close the tender. Try again.' }
  if (!data || data.length === 0) return { error: 'Nothing was changed' }
  revalidatePath(`/projects/${g.tender.project_id}/tenders/${tenderId}`, 'page')
  return { data: true }
}

/** closed → adjudicated: the adjudication is recorded as complete. */
export async function markAdjudicatedAction(tenderId: string): Promise<Result<true>> {
  const g = await gateTender(tenderId)
  if (!g.ok) return { error: g.error }
  if (g.tender.status !== 'closed') return { error: 'Close the tender first' }
  const { data, error } = await g.supabase.schema('projects').from('tenders').update({ status: 'adjudicated' }).eq('id', tenderId).eq('status', 'closed').select('id')
  if (error) return { error: 'Could not record the adjudication. Try again.' }
  if (!data || data.length === 0) return { error: 'Nothing was changed' }
  revalidatePath(`/projects/${g.tender.project_id}/tenders/${tenderId}`, 'page')
  return { data: true }
}
