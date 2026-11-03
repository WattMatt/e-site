import { it, expect } from 'vitest'
import { loadCostVisibility } from './cost-visibility'

const client = (orgRoles: [string, string][], projRoles: [string, string][]) => ({
  from: (t: string) => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: t === 'user_organisations' ? orgRoles.map(([organisation_id, role]) => ({ organisation_id, role })) : [], error: null }) }) }) }),
  schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: projRoles.map(([project_id, role]) => ({ project_id, role })), error: null }) }) }) }) }),
}) as never

it('org PM sees cost; project-promoted PM sees cost; contractor does not', async () => {
  const can = await loadCostVisibility(client([['o1', 'project_manager']], [['p2', 'project_manager']]), 'u1', [{ id: 'p1', organisation_id: 'o1' }, { id: 'p2', organisation_id: 'o9' }, { id: 'p3', organisation_id: 'o9' }])
  expect([can({ id: 'p1', organisation_id: 'o1' }), can({ id: 'p2', organisation_id: 'o9' }), can({ id: 'p3', organisation_id: 'o9' })]).toEqual([true, true, false])
})

it('a contractor role in the project org or on the project does not unlock cost', async () => {
  const can = await loadCostVisibility(client([['o1', 'contractor']], [['p2', 'contractor']]), 'u1', [])
  expect([can({ id: 'p1', organisation_id: 'o1' }), can({ id: 'p2', organisation_id: 'o9' })]).toEqual([false, false])
})
