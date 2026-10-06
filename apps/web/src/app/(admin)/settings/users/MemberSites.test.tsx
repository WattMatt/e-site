// apps/web/src/app/(admin)/settings/users/MemberSites.test.tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemberSites } from './MemberSites'

describe('MemberSites', () => {
  it('owner/admin: All sites', () => {
    render(<MemberSites orgRole="admin" sites={[{ projectId: 'p1', name: 'KINGSWALK', role: 'project_manager' }]} />)
    expect(screen.getByText('All sites')).toBeTruthy()
    expect(screen.queryByText('KINGSWALK')).toBeNull()
  })

  it('contractor with two sites: one link per site to its members page', () => {
    render(<MemberSites orgRole="contractor" sites={[
      { projectId: 'p1', name: 'KINGSWALK', role: 'contractor' },
      { projectId: 'p2', name: 'ITONKA', role: 'contractor' },
    ]} />)
    expect((screen.getByText('KINGSWALK') as HTMLAnchorElement).getAttribute('href')).toBe('/projects/p1/settings/members')
    expect((screen.getByText('ITONKA') as HTMLAnchorElement).getAttribute('href')).toBe('/projects/p2/settings/members')
  })

  it('org project manager is site-only too', () => {
    render(<MemberSites orgRole="project_manager" sites={[]} />)
    expect(screen.queryByText('All sites')).toBeNull()
    expect(screen.getByText('add them to a project')).toBeTruthy()
  })
})
