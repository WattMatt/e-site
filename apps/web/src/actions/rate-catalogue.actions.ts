'use server'

/**
 * Rate library (E6) server actions: the review queue, observation voids,
 * adding a project's BOQ to the library, and "price from library".
 *
 * Gate: the caller's org role must be in COST_VIEW_ROLES (owner / admin /
 * project_manager). Every rate_* read and write goes through the caller's own
 * cookie client, so 00225's RLS is the real boundary and this gate only gives
 * a clear message. The project BOQ (projects.boq_*) is read and re-rated with
 * the service client BEHIND a project gate, the same shape as boq.actions.ts.
 *
 * Every write asserts the rows it changed: a silent zero-row update is
 * reported, never treated as success.
 */
import { revalidatePath } from 'next/cache'
import Anthropic from '@anthropic-ai/sdk'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import {
  boqService, collapseObservations, lineTotalRate, normaliseText, normaliseUnit, proposeRates, COST_VIEW_ROLES,
  RATE_CATEGORIES, type BudgetStatistic, type LibraryObservation, type RateProposal,
} from '@esite/shared'
import {
  ingestSource, loadActiveObservations, loadIndexSeries, loadItems, logRateAccess, type AnyClient, type IngestResult,
} from '@/lib/rate-library/data'
import { loadProjectBoq } from '@/lib/rate-library/project-boq'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }
const QUEUE = ['suggested', 'unmatched', 'rejected'] as const

async function gate(): Promise<{ ok: true; db: AnyClient; orgId: string } | { ok: false; error: string }> {
  const ctx = await getOrgContext()
  if (!ctx) return { ok: false, error: 'Not signed in' }
  if (!COST_VIEW_ROLES.includes(ctx.role)) return { ok: false, error: 'The rate library is limited to owners, admins and project managers' }
  return { ok: true, db: (await createClient()) as AnyClient, orgId: ctx.organisationId }
}

function bust() {
  revalidatePath('/rates')
  revalidatePath('/rates/review')
}

interface QueueLine { id: string; source_id: string; unit: string | null; supply_rate: number | null; install_rate: number | null; rate: number | null; match_status: string }

async function queueLines(db: AnyClient, orgId: string, groupKey: string): Promise<QueueLine[]> {
  const { data, error } = await db.from('rate_source_lines')
    .select('id, source_id, unit, supply_rate, install_rate, rate, match_status')
    .eq('organisation_id', orgId).eq('group_key', groupKey).in('match_status', QUEUE as unknown as string[])
  if (error) throw new Error(error.message)
  return data ?? []
}

/**
 * Assign every queued line of a group to a catalogue item and record the
 * observations. Lines and item must share a unit. If the observation insert
 * fails, the lines are put back as they were.
 */
export async function confirmGroupAction(groupKey: string, itemId: string): Promise<Result<{ lines: number; observations: number }>> {
  const g = await gate(); if (!g.ok) return g
  const { db, orgId } = g
  try {
    const lines = await queueLines(db, orgId, groupKey)
    if (!lines.length) return { ok: false, error: 'Nothing left to confirm in this group; it may already have been reviewed' }
    const { data: item, error: ie } = await db.from('rate_items').select('id, unit, is_active').eq('organisation_id', orgId).eq('id', itemId).maybeSingle()
    if (ie) throw new Error(ie.message)
    if (!item || !item.is_active) return { ok: false, error: 'That catalogue item does not exist or is retired' }
    const units = new Set(lines.map(l => normaliseUnit(l.unit) === 'sum' || normaliseUnit(l.unit) === 'lot' ? 'no' : normaliseUnit(l.unit)))
    if (units.size !== 1 || !units.has(item.unit)) {
      return { ok: false, error: `These lines are priced per ${[...units].join(' / ') || 'nothing'}; the item is per ${item.unit}. Pick or create an item with the same unit.` }
    }
    const priced = lines.filter(l => lineTotalRate({ supplyRate: l.supply_rate, installRate: l.install_rate, rate: l.rate }) > 0)
    if (!priced.length) return { ok: false, error: 'None of these lines carries a rate' }

    const ids = lines.map(l => l.id)
    const { data: upd, error: ue } = await db.from('rate_source_lines')
      .update({ match_status: 'confirmed', matched_item_id: itemId, suggested_item_id: null, match_method: 'manual' })
      .eq('organisation_id', orgId).in('id', ids).in('match_status', QUEUE as unknown as string[]).select('id')
    if (ue) throw new Error(ue.message)
    if ((upd ?? []).length !== ids.length) {
      return { ok: false, error: 'Another reviewer changed some of these lines first. Reload the queue.' }
    }

    const sourceIds = [...new Set(priced.map(l => l.source_id))]
    const { data: sources, error: se } = await db.from('rate_sources')
      .select('id, contractor_name, project_id, project_label, province, priced_on').in('id', sourceIds)
    if (se) throw new Error(se.message)
    const sMap = new Map((sources ?? []).map((s: { id: string }) => [s.id, s]))
    const collapsed = collapseObservations(priced.map((l, i) => ({
      key: l.source_id, unit: item.unit, supplyRate: l.supply_rate, installRate: l.install_rate,
      rate: lineTotalRate({ supplyRate: l.supply_rate, installRate: l.install_rate, rate: l.rate }), lineIndex: i,
    })))
    const rows = collapsed.map(c => {
      const s = sMap.get(c.key) as { contractor_name: string; project_id: string | null; project_label: string | null; province: string | null; priced_on: string }
      return {
        organisation_id: orgId, rate_item_id: itemId, source_id: c.key, source_line_id: priced[c.lineIndexes[0]].id,
        occurrences: c.occurrences, unit: item.unit, supply_rate: c.supplyRate, install_rate: c.installRate, rate: c.rate,
        contractor_name: s.contractor_name, project_id: s.project_id, project_label: s.project_label, province: s.province, priced_on: s.priced_on,
      }
    })
    const { error: oe } = await db.from('rate_observations').insert(rows)
    if (oe) {
      // Compensate: put the lines back in the queue exactly as they were.
      for (const l of lines) {
        await db.from('rate_source_lines').update({ match_status: l.match_status, matched_item_id: null, match_method: null }).eq('id', l.id)
      }
      throw new Error(oe.message)
    }
    bust()
    return { ok: true, data: { lines: ids.length, observations: rows.length } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Confirm failed' }
  }
}

/** Rule categories plus the families the rules do not name (switchgear, fittings …). */
const MANUAL_CATEGORIES: readonly string[] = [...RATE_CATEGORIES, 'other', 'mv_switchgear', 'light_fitting', 'earthing', 'testing_commissioning', 'civil', 'preliminaries']

const slug = (s: string) => normaliseText(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

/** Create a manual catalogue item for a group the rules cannot name, then confirm the group to it. */
export async function createItemForGroupAction(groupKey: string, input: { description: string; unit: string; category: string }): Promise<Result<{ itemId: string; lines: number; observations: number }>> {
  const g = await gate(); if (!g.ok) return g
  const { db, orgId } = g
  const description = input.description.trim()
  const unit = normaliseUnit(input.unit)
  if (description.length < 3) return { ok: false, error: 'Describe the item in a few words' }
  if (!unit || unit === 'other' || unit === 'pct' || unit === 'pc') return { ok: false, error: 'Pick a unit such as m, no, m3, hr or month' }
  const category = MANUAL_CATEGORIES.includes(input.category) ? input.category : 'other'
  const s = slug(description)
  const signature = `manual|${unit}|name=${s}`
  const code = `MAN-${s.toUpperCase()}-${unit.toUpperCase()}`
  const { data: existing } = await db.from('rate_items').select('id').eq('organisation_id', orgId).eq('signature', signature).maybeSingle()
  let itemId: string | undefined = existing?.id
  if (!itemId) {
    const { data, error } = await db.from('rate_items').insert({
      organisation_id: orgId, code, signature, category, description, unit, attributes: {}, origin: 'manual',
    }).select('id').single()
    if (error) return { ok: false, error: error.code === '23505' ? 'An item with that name and unit already exists' : error.message }
    itemId = data.id as string
  }
  const res = await confirmGroupAction(groupKey, itemId!)
  return res.ok ? { ok: true, data: { itemId: itemId!, ...res.data } } : res
}

/** Mark a group as not a rate (it never enters the statistics). */
export async function excludeGroupAction(groupKey: string): Promise<Result<{ lines: number }>> {
  const g = await gate(); if (!g.ok) return g
  const { data, error } = await g.db.from('rate_source_lines')
    .update({ match_status: 'excluded', exclusion_reason: 'not_a_rate', suggested_item_id: null, matched_item_id: null })
    .eq('organisation_id', g.orgId).eq('group_key', groupKey).in('match_status', QUEUE as unknown as string[]).select('id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'Nothing was changed; the group may already have been reviewed' }
  bust()
  return { ok: true, data: { lines: data.length } }
}

/** Turn down a suggestion: the group goes back to unmatched. */
export async function dismissSuggestionAction(groupKey: string): Promise<Result<{ lines: number }>> {
  const g = await gate(); if (!g.ok) return g
  const { data, error } = await g.db.from('rate_source_lines')
    .update({ match_status: 'rejected', suggested_item_id: null })
    .eq('organisation_id', g.orgId).eq('group_key', groupKey).eq('match_status', 'suggested').select('id')
  if (error) return { ok: false, error: error.message }
  if (!data?.length) return { ok: false, error: 'Nothing was changed; the suggestion may already have been reviewed' }
  bust()
  return { ok: true, data: { lines: data.length } }
}

// ── AI suggestion (proposes only; a person confirms) ────────────────────────
const AI_NO_KEY = 'AI suggestions are off: this server has no Anthropic API key.'
const aiModel = () => process.env.RATE_LIBRARY_AI_MODEL || 'claude-sonnet-5-5'

export async function aiSuggestionStatus(): Promise<{ available: boolean; reason: string | null }> {
  const available = Boolean(process.env.ANTHROPIC_API_KEY)
  return { available, reason: available ? null : AI_NO_KEY }
}

const tokens = (s: string) => new Set(normaliseText(s).split(/[^a-z0-9.+]+/).filter(t => t.length > 1))

export async function aiSuggestGroupAction(groupKey: string): Promise<Result<{ itemId: string | null; reason: string }>> {
  const g = await gate(); if (!g.ok) return g
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { ok: false, error: AI_NO_KEY }
  const { db, orgId } = g
  try {
    const { data: lines, error } = await db.from('rate_source_lines').select('id, section_path, description, unit')
      .eq('organisation_id', orgId).eq('group_key', groupKey).in('match_status', ['unmatched', 'rejected']).limit(1)
    if (error) throw new Error(error.message)
    const line = lines?.[0]
    if (!line) return { ok: false, error: 'This group is not waiting for a suggestion' }
    const unit = normaliseUnit(line.unit)
    const want = tokens(`${line.section_path.at(-1) ?? ''} ${line.description}`)
    // Only same-unit items are candidates; rank by word overlap and send the top 40.
    const items = (await loadItems(db, orgId)).filter(i => i.is_active && i.unit === (unit === 'sum' || unit === 'lot' ? 'no' : unit))
    const ranked = items.map(i => ({ i, score: [...tokens(`${i.description} ${i.code}`)].filter(t => want.has(t)).length }))
      .sort((a, b) => b.score - a.score).slice(0, 40).map(x => x.i)
    if (!ranked.length) return { ok: true, data: { itemId: null, reason: `No catalogue item is priced per ${unit ?? 'this unit'} yet` } }
    const client = new Anthropic({ apiKey })
    const res = await client.messages.create({
      model: aiModel(), max_tokens: 1024,
      system: 'You match one line from a South African electrical bill of quantities to a catalogue of priced items. '
        + 'Reply with JSON only: {"code": "<catalogue code>" or null, "reason": "<one sentence>"}. '
        + 'Choose an item only if it is the SAME product, size and installation; otherwise return null. Never guess.',
      messages: [{ role: 'user', content: JSON.stringify({ heading: line.section_path.at(-1) ?? '', description: line.description, unit, catalogue: ranked.map(i => ({ code: i.code, description: i.description })) }) }],
    })
    const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('')
    const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as { code: string | null; reason: string }
    const pick = parsed.code ? ranked.find(i => i.code === parsed.code) ?? null : null
    if (!pick) return { ok: true, data: { itemId: null, reason: parsed.reason || 'No confident match' } }
    const { data: upd, error: ue } = await db.from('rate_source_lines')
      .update({ match_status: 'suggested', suggested_item_id: pick.id, match_method: 'ai', match_detail: { method: 'ai', model: aiModel(), reason: String(parsed.reason ?? '').slice(0, 500) } })
      .eq('organisation_id', orgId).eq('group_key', groupKey).in('match_status', ['unmatched', 'rejected']).select('id')
    if (ue) throw new Error(ue.message)
    if (!upd?.length) return { ok: false, error: 'The group was reviewed while the suggestion was being made' }
    bust()
    return { ok: true, data: { itemId: pick.id, reason: parsed.reason } }
  } catch (e) {
    console.error('[rate-library] ai suggest failed', { err: e instanceof Error ? e.name : 'unknown' })
    return { ok: false, error: 'The AI suggestion failed; review this group by hand' }
  }
}

// ── Corrections ─────────────────────────────────────────────────────────────
/** Retract an observation by adding a void row (observations are never edited). */
export async function voidObservationAction(observationId: string, note: string): Promise<Result<{ voidId: string }>> {
  const g = await gate(); if (!g.ok) return g
  if (note.trim().length < 3) return { ok: false, error: 'Say why this observation is wrong' }
  const { db, orgId } = g
  const { data: o, error } = await db.from('rate_observations')
    .select('id, kind, rate_item_id, source_id, unit, contractor_name, project_id, project_label, province, priced_on')
    .eq('organisation_id', orgId).eq('id', observationId).maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!o || o.kind !== 'observation') return { ok: false, error: 'Observation not found' }
  const { data, error: ie } = await db.from('rate_observations').insert({
    organisation_id: orgId, kind: 'void', rate_item_id: o.rate_item_id, source_id: o.source_id, supersedes_id: o.id, unit: o.unit,
    contractor_name: o.contractor_name, project_id: o.project_id, project_label: o.project_label, province: o.province,
    priced_on: o.priced_on, note: note.trim().slice(0, 500),
  }).select('id').single()
  if (ie) return { ok: false, error: ie.code === '23505' ? 'This observation was already corrected' : ie.message }
  revalidatePath(`/rates/${o.rate_item_id}`)
  bust()
  return { ok: true, data: { voidId: data.id } }
}

// ── Project BOQ ⇄ library ───────────────────────────────────────────────────
async function projectGate(projectId: string): Promise<{ ok: true; db: AnyClient; orgId: string; project: { id: string; name: string; province: string | null } } | { ok: false; error: string }> {
  const g = await gate(); if (!g.ok) return g
  const pg = await requireEffectiveRole(g.db, projectId, COST_VIEW_ROLES)
  if (!pg.ok) return { ok: false, error: pg.error }
  const { data: p, error } = await createServiceClient().schema('projects').from('projects')
    .select('id, name, province, organisation_id').eq('id', projectId).maybeSingle()
  if (error) return { ok: false, error: error.message }
  // The library belongs to the org; a project of another org never feeds it or reads it.
  if (!p || p.organisation_id !== g.orgId) return { ok: false, error: 'Project not found in your organisation' }
  return { ok: true, db: g.db, orgId: g.orgId, project: { id: p.id, name: p.name, province: p.province ?? null } }
}

/** Add this project's current (contractor-priced) BOQ to the rate library. */
export async function addProjectBoqToLibraryAction(projectId: string, input: { contractorName: string; pricedOn?: string }): Promise<Result<IngestResult>> {
  const pg = await projectGate(projectId); if (!pg.ok) return pg
  const contractor = input.contractorName.trim()
  if (contractor.length < 2) return { ok: false, error: 'Name the contractor who priced this BOQ' }
  if (input.pricedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.pricedOn)) return { ok: false, error: 'Priced-on must be a date' }
  try {
    const boq = await loadProjectBoq(createServiceClient(), projectId)
    if (!boq) return { ok: false, error: 'This project has no imported BOQ' }
    const res = await ingestSource(pg.db, pg.orgId, {
      kind: 'boq_import', sourceRef: boq.importId, contractorName: contractor, projectId, projectLabel: pg.project.name,
      province: pg.project.province, pricedOn: input.pricedOn ?? boq.importedAt.slice(0, 10),
      pricedOnBasis: input.pricedOn ? 'stated' : 'import_date', sourceFile: boq.sourceFilename, totalExVat: boq.totalExVat,
      reconciliation: { lines: boq.lines.length, importTotalExVat: boq.totalExVat, sumOfLineAmounts: Math.round(boq.lines.reduce((a, l) => a + (l.amount ?? 0), 0) * 100) / 100 },
    }, boq.lines)
    bust()
    return { ok: true, data: res }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Adding to the library failed' }
  }
}

async function proposalsFor(projectId: string, statistic: BudgetStatistic) {
  const pg = await projectGate(projectId); if (!pg.ok) return pg
  const boq = await loadProjectBoq(createServiceClient(), projectId)
  if (!boq) return { ok: false as const, error: 'This project has no imported BOQ' }
  const [items, obs, cpi] = await Promise.all([loadItems(pg.db, pg.orgId), loadActiveObservations(pg.db, pg.orgId), loadIndexSeries(pg.db)])
  const iMap = new Map(items.map(i => [i.id, i]))
  // Never price a project from its own BOQ's observations.
  const library: LibraryObservation[] = obs.filter(o => o.project_id !== projectId).flatMap(o => {
    const it = iMap.get(o.rate_item_id)
    return it ? [{ signature: it.signature, itemId: it.id, itemCode: it.code, supplyRate: o.supply_rate === null ? null : Number(o.supply_rate), installRate: o.install_rate === null ? null : Number(o.install_rate), rate: Number(o.rate), pricedOn: o.priced_on }] : []
  })
  const proposals = proposeRates(boq.lines.map(l => ({
    boqItemId: l.boqItemId, origin: l.origin, rateModel: l.rateModel, sectionPath: l.sectionPath, description: l.description,
    unit: l.unit, quantityMode: l.quantityMode ?? null, supplyRate: l.supplyRate, installRate: l.installRate, rate: l.rate,
  })), library, cpi, statistic)
  return { ok: true as const, pg, boq, proposals }
}

export interface PricePreviewRow extends RateProposal { description: string; heading: string; unit: string | null }

export async function previewPriceFromLibraryAction(projectId: string, statistic: BudgetStatistic): Promise<Result<{ rows: PricePreviewRow[]; priced: number; skipped: Record<string, number> }>> {
  if (statistic !== 'median' && statistic !== 'p75') return { ok: false, error: 'Statistic must be median or P75' }
  try {
    const r = await proposalsFor(projectId, statistic); if (!r.ok) return r
    const byId = new Map(r.boq.lines.map(l => [l.boqItemId, l]))
    const rows = r.proposals.map(p => { const l = byId.get(p.boqItemId)!; return { ...p, description: l.description, heading: l.sectionPath.at(-1) ?? '', unit: l.unit } })
    const skipped: Record<string, number> = {}
    rows.filter(x => x.status === 'skipped').forEach(x => { skipped[x.reason!] = (skipped[x.reason!] ?? 0) + 1 })
    const priced = rows.filter(x => x.status === 'priced').length
    await logRateAccess(r.pg.db, r.pg.orgId, 'price_from_library', projectId, { mode: 'preview', statistic, priced })
    return { ok: true, data: { rows, priced, skipped } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Preview failed' }
  }
}

/**
 * Write library rates onto the chosen BOQ lines. The proposals are recomputed
 * here, never taken from the browser; only lines of THIS project's current
 * import can be touched.
 */
export async function applyPriceFromLibraryAction(projectId: string, statistic: BudgetStatistic, boqItemIds: string[]): Promise<Result<{ updated: number }>> {
  if (statistic !== 'median' && statistic !== 'p75') return { ok: false, error: 'Statistic must be median or P75' }
  if (!boqItemIds.length) return { ok: false, error: 'Choose at least one line' }
  try {
    const r = await proposalsFor(projectId, statistic); if (!r.ok) return r
    const want = new Set(boqItemIds)
    const chosen = r.proposals.filter(p => want.has(p.boqItemId) && p.status === 'priced' && p.proposed)
    if (chosen.length !== want.size) return { ok: false, error: 'Some chosen lines can no longer be priced from the library. Preview again.' }
    const service = createServiceClient()
    for (const p of chosen) {
      const patch = p.proposed!.rate !== null ? { rate: p.proposed!.rate } : { supplyRate: p.proposed!.supplyRate, installRate: p.proposed!.installRate }
      await boqService.updateItemRate(service as AnyClient, p.boqItemId, patch)
    }
    await logRateAccess(r.pg.db, r.pg.orgId, 'price_from_library', projectId, { mode: 'apply', statistic, updated: chosen.length })
    revalidatePath(`/projects/${projectId}/settings/rates`)
    return { ok: true, data: { updated: chosen.length } }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Applying rates failed' }
  }
}
