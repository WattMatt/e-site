import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { OrgRole } from '@esite/shared'
import { captureActions, orgRoleCanAssignInspection, CAPTURE_KEYS } from './capture-actions'

const P = 'proj-1'
const all = { inspectionsUnlocked: true, canAssignInspection: true }
const keys = (role: OrgRole | null, opts: Partial<typeof all> = {}) =>
  captureActions(P, role, { ...all, ...opts }).map((a) => a.key)

describe('captureActions', () => {
  it('offers all five capture actions to an owner, each scoped to the project', () => {
    const actions = captureActions(P, 'owner', all)
    expect(actions.map((a) => a.key)).toEqual([...CAPTURE_KEYS])
    expect(CAPTURE_KEYS).toEqual(['diary', 'snag', 'form', 'inspection', 'photo'])
    for (const a of actions) expect(a.href.startsWith(`/projects/${P}/`)).toBe(true)
  })

  it('points each action at its existing route', () => {
    const byKey = Object.fromEntries(captureActions(P, 'owner', all).map((a) => [a.key, a.href]))
    expect(byKey).toEqual({
      diary: `/projects/${P}/diary?new=entry`,
      snag: `/projects/${P}/snags/new`,
      form: `/projects/${P}/forms/new`,
      inspection: `/projects/${P}/inspections/new`,
      photo: `/projects/${P}/diary?new=photo`,
    })
  })

  it('a contractor (org role contractor) may capture everything except an inspection', () => {
    expect(keys('contractor', { canAssignInspection: false })).toEqual(['diary', 'snag', 'form', 'photo'])
  })

  it('the inspection tile follows the ORG role, not the effective project role', () => {
    // A contractor promoted to project_manager on one project has effective role
    // PM, but createInspectionAction checks the org role and would refuse them.
    expect(keys('project_manager', { canAssignInspection: false })).not.toContain('inspection')
    expect(keys('project_manager', { canAssignInspection: true })).toContain('inspection')
  })

  it('an inspector gets the field actions only: snag and site form', () => {
    expect(keys('inspector', { canAssignInspection: false })).toEqual(['snag', 'form'])
  })

  it('a supplier gets the field actions only: snag and site form', () => {
    expect(keys('supplier', { canAssignInspection: false })).toEqual(['snag', 'form'])
  })

  it('a client viewer and a caller with no project role get nothing', () => {
    expect(keys('client_viewer', { canAssignInspection: false })).toEqual([])
    expect(keys(null)).toEqual([])
  })

  it('marks the inspection locked (pointing at the unlock page) when the org has not unlocked it', () => {
    const insp = captureActions(P, 'owner', { ...all, inspectionsUnlocked: false }).find((a) => a.key === 'inspection')
    expect(insp?.locked).toBe(true)
    expect(insp?.href).toBe('/inspections/unlock')
    expect(captureActions(P, 'owner', all).find((a) => a.key === 'inspection')?.locked).toBe(false)
  })

  it('encodes the project id', () => {
    const [first] = captureActions('a b/c', 'owner', all)
    expect(first.href).toBe('/projects/a%20b%2Fc/diary?new=entry')
  })
})

describe('orgRoleCanAssignInspection', () => {
  it('admits owner, admin and project_manager only', () => {
    expect(['owner', 'admin', 'project_manager'].every((r) => orgRoleCanAssignInspection(r as OrgRole))).toBe(true)
    expect(['contractor', 'inspector', 'supplier', 'client_viewer'].some((r) => orgRoleCanAssignInspection(r as OrgRole))).toBe(false)
    expect(orgRoleCanAssignInspection(null)).toBe(false)
  })
})

/**
 * The tiles mirror each target's own gate. These read the targets' source, so
 * if a target changes its gate this suite goes red and the mirror is updated in
 * the same change — instead of the Capture page silently offering a page that
 * bounces, or hiding one the caller may use.
 */
describe('capture tiles mirror their targets’ gates (contract)', () => {
  const web = resolve(__dirname, '../../..')
  const src = (rel: string) => readFileSync(resolve(web, rel), 'utf8')
  const mine = src('src/lib/capture/capture-actions.ts')

  it('site form: forms/new gates on FORMS_FIELD_ROLES, and so does the tile', () => {
    expect(src('src/app/(admin)/projects/[id]/forms/new/page.tsx')).toMatch(
      /requireEffectiveRole\([^)]*FORMS_FIELD_ROLES\)/,
    )
    expect(mine).toMatch(/form:\s*FORMS_FIELD_ROLES/)
  })

  it('inspection: createInspectionAction gates on requirePmOrAbove (an org-role check)', () => {
    const actions = src('src/actions/inspections.actions.ts')
    const body = actions.slice(actions.indexOf('export async function createInspectionAction'))
    expect(body.slice(0, 600)).toMatch(/requirePmOrAbove\(/)
  })

  it('diary: the diary page still mounts AddDiaryEntryForm and reads ?new=', () => {
    const page = src('src/app/(admin)/projects/[id]/diary/page.tsx')
    expect(page).toMatch(/<AddDiaryEntryForm[^>]*initialMode=\{captureMode\}/)
    expect(page).toMatch(/newParam === 'photo'/)
  })
})
