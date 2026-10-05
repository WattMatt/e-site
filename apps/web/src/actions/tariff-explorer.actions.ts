'use server'
/**
 * Tariff explorer actions (E7). Any signed-in user may call them; what they
 * return is decided by RLS on the caller's session (00225: the published
 * library is open to every active org member, drafts stay admin-only).
 */
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { AnyClient } from '@/lib/tariffs/admin-gate'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function caller(): Promise<AnyClient | null> {
  const supabase = (await createClient()) as unknown as AnyClient
  const { data: { user } } = await supabase.auth.getUser()
  return user ? supabase : null
}

/** A 10-minute signed URL for a cited source, minted only after the caller can read its row. */
export async function getTariffSourceUrlAction(input: { sourceDocumentId: string }):
  Promise<{ url: string; kind: 'pdf' | 'xlsx' | 'link' } | { error: string }> {
  const supabase = await caller()
  if (!supabase) return { error: 'Sign in to open the source document.' }
  if (!UUID.test(input.sourceDocumentId)) return { error: 'That source document is not available.' }
  const { data, error } = await supabase.schema('tariffs').from('source_document').select('storage_path, url').eq('id', input.sourceDocumentId).maybeSingle()
  if (error) {
    console.error('[tariff-explorer] read failed', { table: 'source_document', code: error.code })
    return { error: 'Could not open the source document. Try again.' }
  }
  const doc = data as { storage_path: string | null; url: string | null } | null
  if (!doc) return { error: 'That source document is not available.' }
  if (doc.storage_path) {
    const svc = createServiceClient() as unknown as AnyClient
    const { data: s, error: se } = await svc.storage.from('tariff-sources').createSignedUrl(doc.storage_path, 600)
    if (se || !s) return { error: 'Could not open the source document. Try again.' }
    return { url: s.signedUrl, kind: doc.storage_path.toLowerCase().endsWith('.pdf') ? 'pdf' : 'xlsx' }
  }
  if (doc.url) return { url: doc.url, kind: 'link' }
  return { error: 'This source has no stored file or link.' }
}

export interface PickerTariff { id: string; name: string; financialYear: string }

/** The tariffs of a licensee's latest published year, for the comparison picker. */
export async function listPublishedTariffsAction(input: { licenseeId: string }): Promise<{ tariffs: PickerTariff[] } | { error: string }> {
  const supabase = await caller()
  if (!supabase) return { error: 'Sign in to compare tariffs.' }
  if (!UUID.test(input.licenseeId)) return { error: 'Choose a supply authority first.' }
  const t = supabase.schema('tariffs')
  const { data: y, error } = await t.from('tariff_year').select('id, financial_year').eq('licensee_id', input.licenseeId).eq('state', 'published').maybeSingle()
  if (error) {
    console.error('[tariff-explorer] read failed', { table: 'tariff_year', code: error.code })
    return { error: 'Could not load the tariffs. Try again.' }
  }
  const year = y as { id: string; financial_year: string } | null
  if (!year) return { tariffs: [] }
  const { data, error: te } = await t.from('tariff').select('id, name').eq('tariff_year_id', year.id).order('name')
  if (te) {
    console.error('[tariff-explorer] read failed', { table: 'tariff', code: te.code })
    return { error: 'Could not load the tariffs. Try again.' }
  }
  return { tariffs: ((data ?? []) as Array<{ id: string; name: string }>).map((r) => ({ id: r.id, name: r.name, financialYear: year.financial_year })) }
}
