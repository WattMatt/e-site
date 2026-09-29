import { describe, it, expect } from 'vitest'
import { acceptBlockers, buildCommitBody, guessKind, initialChoices } from './review-choices'
import { review } from './review-fixture'

const nodes = [{ id: 'n12', label: '12 · Pep', shopNumber: '12' }]

describe('review choices', () => {
  it('pre-fills label, a guessed kind, and the tenant by shop number', () => {
    const c = initialChoices(review(), nodes, null)
    expect(c).toMatchObject({ label: 'PEP', kind: 'tenant', nodeId: 'n12', areaM2: '120', primary: 'p14', include: { p14: true }, meterMode: 'new' })
    expect(guessKind('BULK METER')).toBe('bulk')
    expect(guessKind('SOLAR PLANT 360')).toBe('solar')
  })
  it('an identity conflict blocks until linked or overridden with a reason', () => {
    const r = review({ identity: { sourceSerials: ['S'], filenameSerial: null, conflicts: [{ kind: 'same_body', message: 'Same data as X.', meterId: 'mX' }], blocking: true } })
    const c = initialChoices(r, nodes, null)
    expect(acceptBlockers(r, c, false)).toContain('Resolve the identity conflict.')
    expect(acceptBlockers(r, { ...c, resolution: 'override', reason: 'ok' }, false)).toContain('Give a reason of at least 5 characters for the override.')
    expect(acceptBlockers(r, { ...c, resolution: 'override', reason: 'Different tenant, same CT' }, false)).toEqual([])
    expect(acceptBlockers(r, { ...c, resolution: 'link', meterMode: 'existing', existingMeterId: 'mX' }, false)).toEqual([])
  })
  it('unresolved choices and unapplied options block Accept', () => {
    const r = review({ canAccept: false, choicesNeeded: ['unknown_unit'] })
    expect(acceptBlockers(r, initialChoices(r, nodes, null), false)).toContain('Choose every unit the file does not state, then Re-run preview.')
    expect(acceptBlockers(review(), initialChoices(review(), nodes, null), true)).toContain('Re-run preview to apply your changes.')
    expect(acceptBlockers(review(), initialChoices(review(), nodes, null), false)).toEqual([])
  })
  it('builds the commit body for a new meter', () => {
    const r = review()
    const body = buildCommitBody(r, { ...initialChoices(r, nodes, null), siteLabel: 'YA' }, {})
    expect(body).toEqual({
      mode: 'series', fileId: 'f1',
      meter: { new: { label: 'PEP', kind: 'tenant', siteLabel: 'YA', shopNo: '012', areaM2: 120, areaSource: 'filename', nodeId: 'n12' } },
      identity: { resolution: 'none' },
      channels: [{ sourceColumn: 'p14', include: true, isPrimary: true }],
      options: {},
    })
  })
  it('edit mapping commits to the existing meter', () => {
    const r = review()
    const body = buildCommitBody(r, initialChoices(r, nodes, 'm1'), { tsConvention: 'end' })
    expect(body.meter).toEqual({ existingMeterId: 'm1' })
    expect(body.options).toEqual({ tsConvention: 'end' })
  })
})
