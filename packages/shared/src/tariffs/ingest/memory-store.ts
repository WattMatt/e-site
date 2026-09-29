import type { LicenseeKind, LossFactor, SsegRule, Tariff, YearState } from '../types'
import { normaliseAlias, type ParserName, type SourceDocumentRow, type TariffStore, type YearMeta } from './ingest-core'

export interface MemoryState {
  docs: Map<string, SourceDocumentRow & { id: string }>
  runs: Map<string, { id: string; sourceDocumentId: string; parser: ParserName; status: string; error: string | null }>
  licensees: Map<string, { id: string; name: string; kind: LicenseeKind }>
  aliases: Map<string, string>
  years: Map<string, YearMeta & { id: string; state: YearState; validationBlocking?: number | null }>
  tariffsByYear: Map<string, (Tariff & { id: string })[]>
  links: { tariffId: string; exportTariffId: string }[]
  lossFactors: { yearId: string; factor: LossFactor }[]
  ssegRules: { yearId: string; rule: SsegRule }[]
  uploads: Map<string, number>
  /** Every mutating call, in order: "<kind>:<id>". Empty after a dry run. */
  writes: string[]
}

export interface MemorySeed {
  licensees?: { name: string; kind: LicenseeKind; aliases: string[] }[]
  years?: { licensee: string; financialYear: string; state: YearState; tariffs: Tariff[] }[]
}

export function createMemoryTariffStore(seed?: MemorySeed, opts: { failOnce?: keyof TariffStore } = {}): TariffStore & { state: MemoryState } {
  let n = 0
  const id = (p: string): string => `${p}-${++n}`
  let failPending = opts.failOnce
  const state: MemoryState = {
    docs: new Map(), runs: new Map(), licensees: new Map(), aliases: new Map(), years: new Map(),
    tariffsByYear: new Map(), links: [], lossFactors: [], ssegRules: [], uploads: new Map(), writes: [],
  }
  const maybeFail = (name: keyof TariffStore): void => {
    if (failPending === name) {
      failPending = undefined
      throw new Error(`memory store: injected failure in ${name}`)
    }
  }
  const byName = new Map<string, string>()
  for (const l of seed?.licensees ?? []) {
    const lid = id('lic')
    state.licensees.set(lid, { id: lid, name: l.name, kind: l.kind })
    byName.set(l.name, lid)
    for (const a of l.aliases) state.aliases.set(normaliseAlias(a), lid)
  }
  for (const y of seed?.years ?? []) {
    const yid = id('year')
    state.years.set(yid, {
      id: yid, licenseeId: byName.get(y.licensee) as string, financialYear: y.financialYear, state: y.state,
      effectiveFrom: '2000-01-01', effectiveTo: '2000-12-31', approvedIncreasePct: null, sourceDocumentId: 'seed',
    })
    state.tariffsByYear.set(yid, y.tariffs.map((t) => ({ ...t, id: id('tariff') })))
  }

  return {
    state,
    async findSourceDocumentBySha(sha256) {
      const doc = [...state.docs.values()].find((d) => d.sha256 === sha256)
      if (!doc) return null
      return { id: doc.id, hasSucceededRun: [...state.runs.values()].some((r) => r.sourceDocumentId === doc.id && r.status === 'succeeded') }
    },
    async findLicenseeIdByAlias(alias) {
      return state.aliases.get(alias) ?? null
    },
    async createLicensee({ name, kind, aliases }) {
      maybeFail('createLicensee')
      const lid = id('lic')
      state.licensees.set(lid, { id: lid, name, kind })
      for (const a of aliases) if (!state.aliases.has(a)) state.aliases.set(a, lid)
      state.writes.push(`licensee:${lid}`)
      return lid
    },
    async findYear(licenseeId, financialYear) {
      const y = [...state.years.values()].find((x) => x.licenseeId === licenseeId && x.financialYear === financialYear)
      return y ? { id: y.id, state: y.state } : null
    },
    async loadYearTariffs(yearId) {
      return state.tariffsByYear.get(yearId) ?? []
    },
    async uploadSource(path, bytes) {
      maybeFail('uploadSource')
      if (!state.uploads.has(path)) state.uploads.set(path, bytes.byteLength)
      state.writes.push(`upload:${path}`)
    },
    async insertSourceDocument(row) {
      maybeFail('insertSourceDocument')
      const did = id('doc')
      state.docs.set(did, { ...row, id: did })
      state.writes.push(`doc:${did}`)
      return did
    },
    async insertIngestRun({ sourceDocumentId, parser }) {
      const rid = id('run')
      state.runs.set(rid, { id: rid, sourceDocumentId, parser, status: 'running', error: null })
      state.writes.push(`run:${rid}`)
      return rid
    },
    async finishIngestRun(rid, patch) {
      const run = state.runs.get(rid)
      if (run) Object.assign(run, { status: patch.status, error: patch.error })
      state.writes.push(`run-finish:${rid}`)
    },
    async insertYear(meta) {
      maybeFail('insertYear')
      const yid = id('year')
      state.years.set(yid, { ...meta, id: yid, state: 'ingesting' })
      state.writes.push(`year:${yid}`)
      return yid
    },
    async updateYear(yearId, meta) {
      const y = state.years.get(yearId)
      if (y) Object.assign(y, meta)
      state.writes.push(`year:${yearId}`)
    },
    async setYearState(yearId, s) {
      const y = state.years.get(yearId)
      if (y) y.state = s
      state.writes.push(`year-state:${yearId}:${s}`)
    },
    async recordValidation(yearId, blocking) {
      const y = state.years.get(yearId)
      if (y) y.validationBlocking = blocking
      state.writes.push(`validation:${yearId}:${blocking}`)
    },
    async deleteYearChildren(yearId) {
      state.tariffsByYear.set(yearId, [])
      state.lossFactors = state.lossFactors.filter((f) => f.yearId !== yearId)
      state.ssegRules = state.ssegRules.filter((r) => r.yearId !== yearId)
      state.writes.push(`tariffs-delete:${yearId}`)
    },
    async insertTariffs(yearId, _doc, tariffs) {
      maybeFail('insertTariffs')
      // Mirror of tariffs.charge CHECK charge_block_order, so tests fail where production would.
      for (const t of tariffs) for (const c of t.charges) {
        if (c.blockMaxKwh !== null && (c.blockMinKwh === null || c.blockMaxKwh <= c.blockMinKwh)) {
          throw new Error('charge insert: new row for relation "charge" violates check constraint "charge_block_order"')
        }
        // ...and charge_block_basis_with_block: a basis exactly when there is a lower bound.
        if ((c.blockMinKwh === null) !== (c.blockBasis === null)) {
          throw new Error('charge insert: new row for relation "charge" violates check constraint "charge_block_basis_with_block"')
        }
      }
      const ids = new Map<string, string>()
      const rows = tariffs.map((t) => {
        const tid = id('tariff')
        ids.set(t.name, tid)
        return { ...t, id: tid }
      })
      state.tariffsByYear.set(yearId, [...(state.tariffsByYear.get(yearId) ?? []), ...rows])
      state.writes.push(`tariffs:${yearId}`)
      return ids
    },
    async linkExportTariffs(links) {
      state.links.push(...links)
      state.writes.push(`links:${links.length}`)
    },
    async insertLossFactors(yearId, factors) {
      state.lossFactors.push(...factors.map((factor) => ({ yearId, factor })))
      state.writes.push(`loss-factors:${yearId}`)
    },
    async insertSsegRule(yearId, rule) {
      state.ssegRules.push({ yearId, rule })
      state.writes.push(`sseg-rule:${yearId}`)
    },
  }
}
