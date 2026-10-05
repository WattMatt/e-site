/**
 * Service-role TariffStore for the ingestion CLI. NEVER import this into a
 * client bundle: it is built from a service key and bypasses RLS (the
 * immutability triggers still apply to it).
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  Charge, ChargeComponent, ChargeDayType, BlockBasis, DemandBasis, ExtractionMethod, LossFactor, SourceLocator,
  SsegRule, Tariff, TariffCategory, TariffMetering, TariffSeason, TariffStructure, TariffUnit, TouOrAll, VatBasis, YearState,
} from '../types'
import type { TariffStore, YearMeta } from './ingest-core'
import type { ReferenceDocument } from './reference-documents'
import type { ExistingRegistry, RegistrySeedPlan } from './registry'

type Row = Record<string, unknown>
const CHUNK = 500

function check<T extends { error: { message: string } | null }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`)
  return res
}
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

export function tariffRow(yearId: string, t: Tariff): Row {
  return {
    tariff_year_id: yearId, code: t.code, name: t.name, family: t.family, category: t.category, metering: t.metering,
    structure: t.structure, voltage_band: t.voltageBand, phase: t.phase, transmission_zone: t.transmissionZone,
    local_authority: t.localAuthority, min_amps: t.minAmps, max_amps: t.maxAmps, min_kva: t.minKva, max_kva: t.maxKva,
    is_legacy: t.isLegacy, notes: t.notes, source_locator: t.sourceLocator,
  }
}

export function chargeRow(tariffId: string, sourceDocumentId: string | null, c: Charge): Row {
  return {
    tariff_id: tariffId, component: c.component, season: c.season, tou: c.tou, day_type: c.dayType,
    block_min_kwh: c.blockMinKwh, block_max_kwh: c.blockMaxKwh, block_basis: c.blockBasis, unit: c.unit,
    demand_basis: c.demandBasis, amount_excl_vat: c.amountExclVat, vat_rate: c.vatRate, vat_basis: c.vatBasis,
    unit_inferred: c.unitInferred, inference_reason: c.inferenceReason, source_document_id: sourceDocumentId,
    source_locator: { ...c.sourceLocator, ...(c.label ? { label: c.label } : {}) }, extraction_method: c.extractionMethod,
  }
}

export function chargeFromRow(r: Row): Charge {
  const locator = (r.source_locator ?? {}) as SourceLocator
  return {
    component: r.component as ChargeComponent, season: r.season as TariffSeason, tou: r.tou as TouOrAll,
    dayType: r.day_type as ChargeDayType, blockMinKwh: num(r.block_min_kwh), blockMaxKwh: num(r.block_max_kwh),
    blockBasis: (r.block_basis ?? null) as BlockBasis | null, unit: r.unit as TariffUnit,
    demandBasis: (r.demand_basis ?? null) as DemandBasis | null, amountExclVat: Number(r.amount_excl_vat),
    vatRate: Number(r.vat_rate ?? 0.15), vatBasis: r.vat_basis as VatBasis, unitInferred: Boolean(r.unit_inferred),
    inferenceReason: (r.inference_reason ?? null) as string | null, sourceLocator: locator,
    extractionMethod: r.extraction_method as ExtractionMethod, label: locator.label,
    reviewedAt: (r.reviewed_at ?? null) as string | null,
  }
}

export function tariffFromRows(t: Row, charges: Row[]): Tariff {
  return {
    code: (t.code ?? null) as string | null, name: t.name as string, family: (t.family ?? null) as string | null,
    category: t.category as TariffCategory, metering: t.metering as TariffMetering, structure: t.structure as TariffStructure,
    voltageBand: (t.voltage_band ?? null) as string | null, phase: (t.phase ?? null) as 'single' | 'three' | null,
    transmissionZone: num(t.transmission_zone), localAuthority: Boolean(t.local_authority),
    minAmps: num(t.min_amps), maxAmps: num(t.max_amps), minKva: num(t.min_kva), maxKva: num(t.max_kva),
    isLegacy: Boolean(t.is_legacy), notes: (t.notes ?? null) as string | null,
    charges: charges.map(chargeFromRow), exportTariffCode: null, sourceLocator: (t.source_locator ?? {}) as SourceLocator,
  }
}

function yearRow(meta: YearMeta): Row {
  return {
    licensee_id: meta.licenseeId, financial_year: meta.financialYear, effective_from: meta.effectiveFrom,
    effective_to: meta.effectiveTo, approved_increase_pct: meta.approvedIncreasePct, source_document_id: meta.sourceDocumentId,
  }
}

export function createSupabaseTariffStore(url: string, serviceKey: string): TariffStore {
  const db: SupabaseClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const t = () => db.schema('tariffs')

  return {
    async findSourceDocumentBySha(sha256) {
      const doc = check(await t().from('source_document').select('id').eq('sha256', sha256).maybeSingle(), 'source_document lookup')
      if (!doc.data) return null
      const id = (doc.data as Row).id as string
      const runs = check(await t().from('ingest_run').select('id').eq('source_document_id', id).eq('status', 'succeeded').limit(1), 'ingest_run lookup')
      return { id, hasSucceededRun: (runs.data ?? []).length > 0 }
    },
    async findLicenseeIdByAlias(alias) {
      const r = check(await t().from('licensee_alias').select('licensee_id').eq('alias', alias).maybeSingle(), 'alias lookup')
      return r.data ? ((r.data as Row).licensee_id as string) : null
    },
    async createLicensee({ name, kind, aliases }) {
      const r = check(await t().from('licensee').insert({ name, kind }).select('id').single(), 'licensee insert')
      const id = (r.data as Row).id as string
      if (aliases.length > 0) {
        check(await t().from('licensee_alias').upsert(aliases.map((alias) => ({ alias, licensee_id: id })), { onConflict: 'alias', ignoreDuplicates: true }), 'alias insert')
      }
      return id
    },
    async findYear(licenseeId, financialYear) {
      // Up to two rows since 00232 (a live year and the draft correcting it); never a replaced one.
      const r = check(await t().from('tariff_year').select('id,state,replaces_year_id').eq('licensee_id', licenseeId)
        .eq('financial_year', financialYear).neq('state', 'replaced'), 'year lookup')
      const rows = (r.data as Row[] | null) ?? []
      const y = rows.find((x) => x.state === 'published' || x.state === 'superseded') ?? rows[0]
      return y ? { id: y.id as string, state: y.state as YearState, replacesYearId: (y.replaces_year_id as string | null) ?? null } : null
    },
    async findCorrectionDraft(yearId) {
      const r = check(await t().from('tariff_year').select('id,state').eq('replaces_year_id', yearId)
        .in('state', ['ingesting', 'in_review']).maybeSingle(), 'correction lookup')
      return r.data ? { id: (r.data as Row).id as string, state: (r.data as Row).state as YearState, replacesYearId: yearId } : null
    },
    async loadYearTariffs(yearId) {
      const ts = check(await t().from('tariff').select('*').eq('tariff_year_id', yearId), 'tariff load').data as Row[] | null ?? []
      const ids = ts.map((x) => x.id as string)
      const charges: Row[] = []
      for (let i = 0; i < ids.length; i += CHUNK) {
        const r = check(await t().from('charge').select('*').in('tariff_id', ids.slice(i, i + CHUNK)), 'charge load')
        charges.push(...((r.data as Row[] | null) ?? []))
      }
      return ts.map((x) => tariffFromRows(x, charges.filter((c) => c.tariff_id === x.id)))
    },
    async uploadSource(path, bytes, contentType) {
      const r = await db.storage.from('tariff-sources').upload(path, bytes, { contentType, upsert: false })
      if (r.error && !/exists|duplicate/i.test(r.error.message)) throw new Error(`upload ${path}: ${r.error.message}`)
    },
    async insertSourceDocument(row) {
      const r = check(await t().from('source_document').insert({
        kind: row.kind, title: row.title, financial_year: row.financialYear, status: row.status, storage_path: row.storagePath,
        sha256: row.sha256, page_count: row.pageCount, url: row.url, retrieved_at: row.retrievedAt,
      }).select('id').single(), 'source_document insert')
      return (r.data as Row).id as string
    },
    async insertIngestRun({ sourceDocumentId, parser, startedBy }) {
      const r = check(await t().from('ingest_run').insert({ source_document_id: sourceDocumentId, parser, status: 'running', started_by: startedBy }).select('id').single(), 'ingest_run insert')
      return (r.data as Row).id as string
    },
    async finishIngestRun(id, patch) {
      check(await t().from('ingest_run').update({ status: patch.status, stats: patch.stats, diff: patch.diff, error: patch.error, finished_at: new Date().toISOString() }).eq('id', id), 'ingest_run finish')
    },
    async insertYear(meta, replacesYearId) {
      const r = check(await t().from('tariff_year').insert({ ...yearRow(meta), state: 'ingesting', ...(replacesYearId ? { replaces_year_id: replacesYearId } : {}) }).select('id').single(), 'year insert')
      return (r.data as Row).id as string
    },
    async updateYear(yearId, meta) {
      check(await t().from('tariff_year').update(yearRow(meta)).eq('id', yearId), 'year update')
    },
    async setYearState(yearId, state) {
      check(await t().from('tariff_year').update({ state }).eq('id', yearId), `year -> ${state}`)
    },
    async recordValidation(yearId, blocking) {
      check(await t().from('tariff_year').update({ validation_blocking: blocking, validated_at: new Date().toISOString() }).eq('id', yearId), 'year validation')
    },
    async deleteYearChildren(yearId) {
      check(await t().from('tariff').delete().eq('tariff_year_id', yearId), 'tariff delete')
      check(await t().from('loss_factor').delete().eq('tariff_year_id', yearId), 'loss_factor delete')
      check(await t().from('sseg_rule').delete().eq('tariff_year_id', yearId), 'sseg_rule delete')
    },
    async insertTariffs(yearId, sourceDocumentId, tariffs) {
      const ids = new Map<string, string>()
      for (let i = 0; i < tariffs.length; i += CHUNK) {
        const r = check(await t().from('tariff').insert(tariffs.slice(i, i + CHUNK).map((x) => tariffRow(yearId, x))).select('id,name'), 'tariff insert')
        for (const row of (r.data as Row[] | null) ?? []) ids.set(row.name as string, row.id as string)
      }
      const charges = tariffs.flatMap((x) => x.charges.map((c) => chargeRow(ids.get(x.name) as string, sourceDocumentId, c)))
      for (let i = 0; i < charges.length; i += CHUNK) {
        check(await t().from('charge').insert(charges.slice(i, i + CHUNK)), 'charge insert')
      }
      return ids
    },
    async linkExportTariffs(links) {
      for (const l of links) check(await t().from('tariff').update({ export_tariff_id: l.exportTariffId }).eq('id', l.tariffId), 'export link')
    },
    async insertLossFactors(yearId, factors: LossFactor[]) {
      check(await t().from('loss_factor').insert(factors.map((f) => ({
        tariff_year_id: yearId, kind: f.kind, voltage_band: f.voltageBand, transmission_zone: f.transmissionZone,
        factor: f.factor, source_locator: f.sourceLocator,
      }))), 'loss_factor insert')
    },
    async insertSsegRule(yearId, rule: SsegRule) {
      // Owner default 9: cite the stored Rules document. It is seeded before ingestion; a missing one is an error, not a silent null.
      let sourceDocumentId: string | null = null
      if (rule.sourceDocumentSha256) {
        const doc = check(await t().from('source_document').select('id').eq('sha256', rule.sourceDocumentSha256).maybeSingle(), 'rules document lookup')
        if (!doc.data) throw new Error(`sseg_rule cites Rules document ${rule.sourceDocumentSha256} which is not seeded: run seed-licensee-registry.ts first`)
        sourceDocumentId = (doc.data as Row).id as string
      }
      check(await t().from('sseg_rule').insert({
        source_document_id: sourceDocumentId,
        tariff_year_id: yearId, crediting: rule.crediting, carry_forward: rule.carryForward, fy_end_month: rule.fyEndMonth,
        cap_rule: rule.capRule, offsets: rule.offsets, forfeit_on_ownership_change: rule.forfeitOnOwnershipChange,
        max_kva: rule.maxKva, requires_tou: rule.requiresTou, requires_bidirectional_meter: rule.requiresBidirectionalMeter,
        locator: rule.locator,
      }), 'sseg_rule insert')
    },
  }
}

function serviceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

/** Read-only: the live licensee registry, for planning a seed. */
export async function readLicenseeRegistry(url: string, serviceKey: string): Promise<ExistingRegistry> {
  const t = serviceClient(url, serviceKey).schema('tariffs')
  const lic = check(await t.from('licensee').select('id,name'), 'licensee read')
  const ali = check(await t.from('licensee_alias').select('alias,licensee_id'), 'licensee_alias read')
  return {
    licensees: ((lic.data ?? []) as Row[]).map((r) => ({ id: r.id as string, name: r.name as string })),
    aliases: ((ali.data ?? []) as Row[]).map((r) => ({ alias: r.alias as string, licenseeId: r.licensee_id as string })),
  }
}

/** Service-role writes for a registry seed plan: inserts and alias additions only, never deletes. */
export async function applyLicenseeRegistrySeed(url: string, serviceKey: string, plan: RegistrySeedPlan): Promise<void> {
  const t = serviceClient(url, serviceKey).schema('tariffs')
  for (const e of plan.insert) {
    const r = check(await t.from('licensee').insert({ name: e.name, kind: e.kind, province: e.province }).select('id').single(), `licensee ${e.name}`)
    const id = (r.data as Row).id as string
    check(await t.from('licensee_alias').insert(e.aliases.map((alias) => ({ alias, licensee_id: id }))), `aliases for ${e.name}`)
  }
  for (const x of plan.addAliases) {
    check(await t.from('licensee_alias').insert(x.aliases.map((alias) => ({ alias, licensee_id: x.licenseeId }))), `aliases for ${x.name}`)
  }
}

/** Is this reference document already recorded? By sha256 for a file, by (kind, url, financial year) for a URL-only one. */
export async function referenceDocumentExists(url: string, serviceKey: string, doc: ReferenceDocument): Promise<boolean> {
  const t = serviceClient(url, serviceKey).schema('tariffs')
  const q = doc.sha256
    ? t.from('source_document').select('id').eq('sha256', doc.sha256)
    : t.from('source_document').select('id').eq('kind', doc.kind).eq('url', doc.url ?? '').is('sha256', null)
  const r = check(await q.limit(1), 'reference document lookup')
  return ((r.data as Row[] | null) ?? []).length > 0
}

/** Service-role write of one reference document (upload first when it is a file). Idempotent. */
export async function insertReferenceDocument(url: string, serviceKey: string, doc: ReferenceDocument, bytes: Uint8Array | null): Promise<void> {
  if (await referenceDocumentExists(url, serviceKey, doc)) return
  const db = serviceClient(url, serviceKey)
  if (doc.storagePath) {
    if (!bytes) throw new Error(`${doc.title}: file bytes are required to upload ${doc.storagePath}`)
    const up = await db.storage.from('tariff-sources').upload(doc.storagePath, bytes, { contentType: 'application/pdf', upsert: false })
    if (up.error && !/exists|duplicate/i.test(up.error.message)) throw new Error(`upload ${doc.storagePath}: ${up.error.message}`)
  }
  let licenseeId: string | null = null
  if (doc.licenseeAlias) {
    const a = check(await db.schema('tariffs').from('licensee_alias').select('licensee_id').eq('alias', doc.licenseeAlias).maybeSingle(), 'alias lookup')
    if (!a.data) throw new Error(`${doc.title}: licensee alias ${doc.licenseeAlias} is not seeded`)
    licenseeId = (a.data as Row).licensee_id as string
  }
  check(await db.schema('tariffs').from('source_document').insert({
    licensee_id: licenseeId, kind: doc.kind, title: doc.title, financial_year: doc.financialYear, status: doc.status,
    storage_path: doc.storagePath, sha256: doc.sha256, page_count: doc.pageCount, url: doc.url, retrieved_at: new Date().toISOString(),
  }), `reference document ${doc.title}`)
}
