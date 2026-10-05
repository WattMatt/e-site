import { describe, it, expect } from 'vitest'
import { ORG_ROLES, type OrgRole } from '@esite/shared'
import { captureActions, CAPTURE_KEYS } from './capture-actions'

const P = 'proj-1'
const keys = (role: OrgRole | null, inspectionsUnlocked = true) =>
  captureActions(P, role, { inspectionsUnlocked }).map((a) => a.key)

describe('captureActions', () => {
  it('offers all five capture actions to an owner, each scoped to the project', () => {
    const actions = captureActions(P, 'owner', { inspectionsUnlocked: true })
    expect(actions.map((a) => a.key)).toEqual([...CAPTURE_KEYS])
    expect(CAPTURE_KEYS).toEqual(['diary', 'snag', 'form', 'inspection', 'photo'])
    for (const a of actions) expect(a.href.startsWith(`/projects/${P}/`)).toBe(true)
  })

  it('points each action at its existing route', () => {
    const byKey = Object.fromEntries(
      captureActions(P, 'owner', { inspectionsUnlocked: true }).map((a) => [a.key, a.href]),
    )
    expect(byKey).toEqual({
      diary: `/projects/${P}/diary?new=entry`,
      snag: `/projects/${P}/snags/new`,
      form: `/projects/${P}/forms/new`,
      inspection: `/projects/${P}/inspections/new`,
      photo: `/projects/${P}/diary?new=photo`,
    })
  })

  it('a contractor may capture everything except an inspection (PM+ only)', () => {
    expect(keys('contractor')).toEqual(['diary', 'snag', 'form', 'photo'])
  })

  it('an inspector gets the field actions only: snag and site form', () => {
    expect(keys('inspector')).toEqual(['snag', 'form'])
  })

  it('a supplier gets the field actions only: snag and site form', () => {
    expect(keys('supplier')).toEqual(['snag', 'form'])
  })

  it('a client viewer and a non-member get nothing', () => {
    expect(keys('client_viewer')).toEqual([])
    expect(keys(null)).toEqual([])
  })

  it('marks the inspection locked (pointing at the unlock page) when the org has not unlocked it', () => {
    const insp = captureActions(P, 'owner', { inspectionsUnlocked: false }).find((a) => a.key === 'inspection')
    expect(insp?.locked).toBe(true)
    expect(insp?.href).toBe('/inspections/unlock')
    const open = captureActions(P, 'owner', { inspectionsUnlocked: true }).find((a) => a.key === 'inspection')
    expect(open?.locked).toBe(false)
  })

  it('encodes the project id', () => {
    const [first] = captureActions('a b/c', 'owner', { inspectionsUnlocked: true })
    expect(first.href).toBe('/projects/a%20b%2Fc/diary?new=entry')
  })

  it('covers every role without throwing', () => {
    for (const r of ORG_ROLES) expect(Array.isArray(captureActions(P, r, { inspectionsUnlocked: true }))).toBe(true)
  })
})
