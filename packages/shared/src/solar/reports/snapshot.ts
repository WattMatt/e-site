/**
 * The frozen proposal snapshot (functional spec §9.3 Issue, §9.4). Written once at Issue into
 * solar.proposals.snapshot and never recomputed; the token page, the portal and the PDF all render
 * it. It holds the CLIENT price only — capex and margin stay in the (money-gated) draft.
 */
import type { RunKpis, TariffRef } from '../cases/outputs'
import { VAT_RATE } from '../cases/finance-config'
import type { OfferPrice } from './offer'
import type { FinanceOptionSummary } from './finance-options'
import { FINANCE_OPTION_LABELS, type ProposalDraft } from './proposal-draft'
import { fixed, isoDate, kw, kwp, mwh, pct, years, zar, zarCents } from './fmt'

export const SNAPSHOT_VERSION = 1 as const

export interface ProposalSnapshot {
  version: typeof SNAPSHOT_VERSION
  proposal: { id: string; familyId: string; version: number; title: string; issuedAt: string; validUntil: string }
  issuer: { orgName: string; proposerName: string; proposerEmail: string | null }
  client: { name: string }
  project: { name: string; address: string | null }
  case: { id: string; name: string; runId: string; inputsHash: string; engineVersion: string; runFinishedAt: string }
  system: {
    dcKwp: number; acKw: number; batteryKwh: number | null; batteryKw: number | null
    year1PvKwh: number; specificYieldKwhPerKwp: number; selfConsumption: number; solarFraction: number; exportKwh: number
  }
  price: { offerExclVatZar: number; vatZar: number; offerInclVatZar: number }
  bills: { beforeZar: number; afterZar: number; savingZar: number } | null
  financeOptions: FinanceOptionSummary[]
  text: {
    summary: string; scope: string; priceTerms: string; assumptions: string
    inclusions: string[]; exclusions: string[]; terms: string; narrative: string; disclaimer: string
  }
  provenance: { financeInputsHash: string; tariff: TariffRef | null }
}

export interface BuildSnapshotInput {
  proposal: ProposalSnapshot['proposal']
  issuer: ProposalSnapshot['issuer']
  project: ProposalSnapshot['project']
  case: ProposalSnapshot['case']
  kpis: Pick<RunKpis, 'dcKwp' | 'acKw' | 'batteryKwh' | 'batteryKw' | 'annualAcKwh' | 'specificYieldKwhPerKwp' | 'selfConsumption' | 'solarFraction' | 'exportKwh'>
  price: OfferPrice
  bills: { beforeZar: number; afterZar: number } | null
  financeOptions: FinanceOptionSummary[]
  draft: ProposalDraft
  disclaimer: string
  provenance: ProposalSnapshot['provenance']
}

const r3 = (x: number) => Math.round(x * 1000) / 1000
const r2 = (x: number) => Math.round(x * 100) / 100

export function buildProposalSnapshot(i: BuildSnapshotInput, sanitize: (s: string) => string = (s) => s): ProposalSnapshot {
  const t = sanitize
  const tr = i.provenance.tariff
  return {
    version: SNAPSHOT_VERSION,
    proposal: { ...i.proposal, title: t(i.proposal.title) },
    issuer: { orgName: t(i.issuer.orgName), proposerName: t(i.issuer.proposerName), proposerEmail: i.issuer.proposerEmail },
    client: { name: t(i.draft.clientName) },
    project: { name: t(i.project.name), address: i.project.address === null ? null : t(i.project.address) },
    case: { ...i.case, name: t(i.case.name) },
    system: {
      dcKwp: r3(i.kpis.dcKwp), acKw: r3(i.kpis.acKw),
      batteryKwh: i.kpis.batteryKwh === null ? null : r3(i.kpis.batteryKwh),
      batteryKw: i.kpis.batteryKw === null ? null : r3(i.kpis.batteryKw),
      year1PvKwh: r3(i.kpis.annualAcKwh), specificYieldKwhPerKwp: r3(i.kpis.specificYieldKwhPerKwp),
      selfConsumption: r3(i.kpis.selfConsumption), solarFraction: r3(i.kpis.solarFraction), exportKwh: r3(i.kpis.exportKwh),
    },
    price: { offerExclVatZar: i.price.offerExclVatZar, vatZar: i.price.vatZar, offerInclVatZar: i.price.offerInclVatZar },
    bills: i.bills ? { beforeZar: r2(i.bills.beforeZar), afterZar: r2(i.bills.afterZar), savingZar: r2(i.bills.beforeZar - i.bills.afterZar) } : null,
    financeOptions: i.financeOptions.map((o) => ({ ...o, terms: t(o.terms) })),
    text: {
      summary: t(i.draft.summary), scope: t(i.draft.scope), priceTerms: t(i.draft.priceTerms), assumptions: t(i.draft.assumptions),
      inclusions: i.draft.inclusions.map(t), exclusions: i.draft.exclusions.map(t),
      terms: t(i.draft.terms), narrative: t(i.draft.narrative), disclaimer: t(i.disclaimer),
    },
    provenance: {
      financeInputsHash: i.provenance.financeInputsHash,
      tariff: tr ? { tariffId: tr.tariffId, tariffName: t(tr.tariffName), financialYear: tr.financialYear, licenseeName: t(tr.licenseeName) } : null,
    },
  }
}

/** The fields of one finance option a client sees (financeOptionTable + labels) — no npv, no view. */
export type ClientFinanceOption = Pick<FinanceOptionSummary,
  'kind' | 'terms' | 'upfrontZar' | 'year1NetZar' | 'lifetimeNetZar' | 'years' | 'simplePaybackYears' | 'irr'>

/**
 * What reaches a CLIENT'S browser (token page, portal): only what ProposalClientView renders. The
 * frozen snapshot also carries the proposal/family ids, the case, run id, inputs hash, engine
 * version and provenance — internal evidence that stays server-side (review I3). keyFigures() and
 * financeOptionTable() accept this shape, so the page prints the same strings as the PDF.
 */
export interface ProposalClientSnapshot {
  proposal: Pick<ProposalSnapshot['proposal'], 'title' | 'issuedAt' | 'validUntil' | 'version'>
  issuer: ProposalSnapshot['issuer']
  client: ProposalSnapshot['client']
  project: ProposalSnapshot['project']
  system: Pick<ProposalSnapshot['system'], 'dcKwp' | 'acKw' | 'batteryKwh' | 'batteryKw' | 'year1PvKwh' | 'specificYieldKwhPerKwp' | 'solarFraction'>
  price: ProposalSnapshot['price']
  bills: { savingZar: number } | null
  financeOptions: ClientFinanceOption[]
  text: ProposalSnapshot['text']
}

/** Field-by-field copy (never a spread), so a field added to the snapshot later does not leak. */
export function toClientSnapshot(s: ProposalSnapshot): ProposalClientSnapshot {
  const y = s.system
  return {
    proposal: { title: s.proposal.title, issuedAt: s.proposal.issuedAt, validUntil: s.proposal.validUntil, version: s.proposal.version },
    issuer: { orgName: s.issuer.orgName, proposerName: s.issuer.proposerName, proposerEmail: s.issuer.proposerEmail },
    client: { name: s.client.name },
    project: { name: s.project.name, address: s.project.address },
    system: {
      dcKwp: y.dcKwp, acKw: y.acKw, batteryKwh: y.batteryKwh, batteryKw: y.batteryKw,
      year1PvKwh: y.year1PvKwh, specificYieldKwhPerKwp: y.specificYieldKwhPerKwp, solarFraction: y.solarFraction,
    },
    price: { offerExclVatZar: s.price.offerExclVatZar, vatZar: s.price.vatZar, offerInclVatZar: s.price.offerInclVatZar },
    bills: s.bills ? { savingZar: s.bills.savingZar } : null,
    financeOptions: s.financeOptions.map((o) => ({
      kind: o.kind, terms: o.terms, upfrontZar: o.upfrontZar, year1NetZar: o.year1NetZar, lifetimeNetZar: o.lifetimeNetZar,
      years: o.years, simplePaybackYears: o.simplePaybackYears, irr: o.irr,
    })),
    text: {
      summary: s.text.summary, scope: s.text.scope, priceTerms: s.text.priceTerms, assumptions: s.text.assumptions,
      inclusions: [...s.text.inclusions], exclusions: [...s.text.exclusions],
      terms: s.text.terms, narrative: s.text.narrative, disclaimer: s.text.disclaimer,
    },
  }
}

export interface KeyFigure { label: string; value: string }

/** The inputs keyFigures reads — satisfied by the full snapshot (PDF) and the client snapshot (page). */
export type KeyFigureSource = Pick<ProposalClientSnapshot, 'system' | 'price' | 'bills'> & { proposal: Pick<ProposalSnapshot['proposal'], 'validUntil'> }

export function keyFigures(s: KeyFigureSource): KeyFigure[] {
  const out: KeyFigure[] = [{ label: 'System size', value: `${kwp(s.system.dcKwp)} DC / ${kw(s.system.acKw)} AC` }]
  if (s.system.batteryKwh !== null) out.push({ label: 'Battery', value: `${fixed(s.system.batteryKwh, 1)} kWh / ${kw(s.system.batteryKw ?? 0)}` })
  out.push(
    { label: 'Year-1 solar generation', value: mwh(s.system.year1PvKwh) },
    { label: 'Specific yield', value: `${fixed(s.system.specificYieldKwhPerKwp, 0)} kWh/kWp` },
    { label: 'Share of your consumption from solar', value: pct(s.system.solarFraction) },
    { label: 'Offer price (excl. VAT)', value: zarCents(s.price.offerExclVatZar) },
    { label: `VAT (${fixed(VAT_RATE * 100, 0)} %)`, value: zarCents(s.price.vatZar) },
    { label: 'Offer price (incl. VAT)', value: zarCents(s.price.offerInclVatZar) },
  )
  if (s.bills) out.push({ label: 'Estimated year-1 electricity saving (excl. VAT)', value: zar(s.bills.savingZar) })
  out.push({ label: 'Valid until', value: isoDate(s.proposal.validUntil) })
  return out
}

export interface FinanceOptionTable { columns: string[]; rows: string[][] }

export function financeOptionTable(s: { financeOptions: readonly ClientFinanceOption[] }): FinanceOptionTable {
  const o = s.financeOptions
  return {
    columns: ['', ...o.map((x) => FINANCE_OPTION_LABELS[x.kind])],
    rows: [
      ['Terms', ...o.map((x) => x.terms)],
      ['Upfront payment', ...o.map((x) => zar(x.upfrontZar))],
      ['Year-1 net benefit', ...o.map((x) => zar(x.year1NetZar))],
      ['Net benefit over the term', ...o.map((x) => `${zar(x.lifetimeNetZar)} (${x.years} years)`)],
      ['Simple payback', ...o.map((x) => years(x.simplePaybackYears))],
      ['IRR', ...o.map((x) => pct(x.irr))],
    ],
  }
}
