import { normShop } from '@esite/shared/solar-load'
import type { IdentityPanel, ReviewModel } from '@/lib/solar/meter-import/review'
import type { ParseOptionsInput } from '@/lib/solar/load/import-client'
import type { MeterKind, NodeOption } from '@/lib/solar/load/view-types'

export interface Choices {
  dateOrder: '' | 'DMY' | 'MDY' | 'YMD'
  tsConvention: '' | 'begin' | 'end'
  units: Record<string, string>
  areaM2: string
  meterMode: 'new' | 'existing'
  existingMeterId: string
  label: string
  kind: MeterKind | ''
  siteLabel: string
  shopNo: string
  nodeId: string
  /** 'skip' is a UI choice only (the footer's Skip commits it); it never reaches a series commit body. */
  resolution: 'none' | 'link' | 'override' | 'skip'
  reason: string
  include: Record<string, boolean>
  primary: string
  skipReason: string
  registerSite: string
}

export function guessKind(label: string | null | undefined): MeterKind {
  const s = label ?? ''
  if (/\b(bulk|incomer)\b/i.test(s)) return 'bulk'
  if (/\bsolar\b|\bpv\b/i.test(s)) return 'solar'
  if (/\bgen(erator)?\b/i.test(s)) return 'generator'
  if (/\bcheck\b/i.test(s)) return 'check'
  if (/\bcouncil\b/i.test(s)) return 'council'
  if (/\bcommon\b/i.test(s)) return 'common'
  if (/\bvacant\b/i.test(s)) return 'vacant'
  return 'tenant'
}

/** An exact data duplicate: the same readings already imported, or in another file of this upload. */
export function sameBodyConflict(identity: IdentityPanel | null | undefined) {
  return identity?.blocking ? identity.conflicts.find((c) => c.kind === 'same_body') : undefined
}

/**
 * Choices for an identity panel that just arrived (first render, or a 409 from the server). An exact
 * duplicate defaults to Skip with the reason filled in: it is usually the portal serving another
 * meter's data, and both other ways out (link = merge into that meter, override = a second meter with
 * the same readings) are wrong in that case.
 */
export function choicesForIdentity(c: Choices, identity: IdentityPanel | null | undefined, editMeterId: string | null): Choices {
  const dup = editMeterId ? undefined : sameBodyConflict(identity)
  if (!dup) return c
  return { ...c, resolution: 'skip', skipReason: c.skipReason || `Duplicate data: ${dup.message}`.slice(0, 480) }
}

export function initialChoices(r: ReviewModel, nodes: NodeOption[], editMeterId: string | null): Choices {
  const shop = normShop(r.hints.shopNo)
  const label = r.hints.label ?? r.fileName.replace(/\.[^.]+$/, '')
  return choicesForIdentity({
    dateOrder: '', tsConvention: '', units: {}, areaM2: r.hints.areaM2 == null ? '' : String(r.hints.areaM2),
    meterMode: editMeterId ? 'existing' : 'new', existingMeterId: editMeterId ?? '',
    label, kind: guessKind(label), siteLabel: r.hints.site ?? '', shopNo: r.hints.shopNo ?? '',
    nodeId: (shop ? nodes.find((n) => normShop(n.shopNumber) === shop)?.id : undefined) ?? '',
    resolution: 'none', reason: '',
    include: Object.fromEntries(r.channels.map((c) => [c.column, c.sourceUnit !== 'unknown'])),
    primary: r.channels.find((c) => c.isPrimaryDefault)?.column ?? '',
    skipReason: r.blockingErrors.length > 0 ? `Cannot import: ${r.report.errors.map((e) => e.message).join('; ')}`.slice(0, 480) : '',
    registerSite: r.hints.site ?? '',
  }, r.identity, editMeterId)
}

/** The options the user changed that the preview has not applied yet. */
export function optionsFrom(c: Choices): ParseOptionsInput {
  const o: ParseOptionsInput = {}
  if (c.dateOrder) o.dateOrder = c.dateOrder
  if (c.tsConvention) o.tsConvention = c.tsConvention
  if (Object.keys(c.units).length > 0) o.units = c.units
  const a = Number(c.areaM2)
  if (c.areaM2.trim() !== '' && Number.isFinite(a) && a > 0) o.areaM2 = a
  return o
}

/** Why Accept is disabled (empty = enabled). */
export function acceptBlockers(r: ReviewModel, c: Choices, optionsDirty: boolean): string[] {
  const out: string[] = []
  if (r.outcome !== 'series') return ['This file is not meter data.']
  if (r.blockingErrors.length > 0) return ['The file has errors that cannot be fixed here — skip it with the reason shown.']
  if (optionsDirty) out.push('Re-run preview to apply your changes.')
  else if (!r.canAccept) out.push('Choose every unit the file does not state, then Re-run preview.')
  if (c.meterMode === 'existing' ? !c.existingMeterId : !(c.label.trim() && c.kind)) out.push('Name the meter and choose its kind.')
  if (!c.primary || !c.include[c.primary]) out.push('Choose an included primary channel.')
  if (r.identity?.blocking) {
    if (c.resolution === 'none') out.push('Resolve the identity conflict.')
    if (c.resolution === 'skip') out.push('You chose to skip this file — press Skip this file.')
    if (c.resolution === 'override' && c.reason.trim().length < 5) out.push('Give a reason of at least 5 characters for the override.')
    if (c.resolution === 'link' && !(c.meterMode === 'existing' && c.existingMeterId)) out.push('Choose the existing meter to link to.')
  }
  return out
}

export function buildCommitBody(r: ReviewModel, c: Choices, applied: ParseOptionsInput): Record<string, unknown> {
  const area = Number(c.areaM2)
  const hasArea = c.areaM2.trim() !== '' && Number.isFinite(area) && area > 0
  const reg = r.hints.register.find((x) => x.areaM2 === area)
  const areaSource = !hasArea ? null
    : r.hints.areaM2 === area ? 'filename'
      : reg ? (reg.matchMethod === 'exact' || reg.matchMethod === 'manual' ? 'register_exact' : 'register_llm')
        : 'manual'
  return {
    mode: 'series',
    fileId: r.fileId,
    ...(r.sheetName ? { sheet: r.sheetName } : {}),
    meter: c.meterMode === 'existing'
      ? { existingMeterId: c.existingMeterId }
      : { new: { label: c.label.trim(), kind: c.kind, siteLabel: c.siteLabel.trim() || null, shopNo: c.shopNo.trim() || null, areaM2: hasArea ? area : null, areaSource, nodeId: c.nodeId || null } },
    identity: c.resolution === 'override' ? { resolution: 'override', reason: c.reason.trim() } : { resolution: c.resolution === 'skip' ? 'none' : c.resolution },
    channels: r.channels.map((ch) => ({ sourceColumn: ch.column, include: Boolean(c.include[ch.column]), isPrimary: ch.column === c.primary })),
    options: applied,
  }
}
