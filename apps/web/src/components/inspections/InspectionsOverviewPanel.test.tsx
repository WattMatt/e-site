import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import InspectionsOverviewPanel from './InspectionsOverviewPanel'
import type { InspectionOverview } from '@esite/shared'

const overview: InspectionOverview = {
  counts: { open: 4, awaiting: 1, sentBack: 1, certified: 1 },
  toVerify: 1,
  truncated: false,
  waitingOnYou: [
    { id: 'i-shop', target_label: 'Shoprite', project_id: 'p-zzs', status: 'awaiting_verification', assigned_to_id: 'u-e', verifier_id: 'u-e', updated_at: '2026-10-12T12:30:50Z', project_name: 'ZZ status-guard test', yours: 'verify' },
  ],
  recent: [
    { id: 'i-mini', target_label: 'MINISUB 1', project_id: 'p-zzs', status: 'in_progress', assigned_to_id: 'u-r', verifier_id: 'u-e', updated_at: '2026-10-12T12:55:58Z', project_name: 'ZZ status-guard test', yours: null },
  ],
}

describe('InspectionsOverviewPanel', () => {
  it('shows every state and what is waiting on you, linked to the inspection', () => {
    render(<InspectionsOverviewPanel overview={overview} />)
    expect(screen.getByText('Awaiting verification')).toBeTruthy()
    expect(screen.getByText('Sent back')).toBeTruthy()
    const shoprite = screen.getByRole('link', { name: /Shoprite/ })
    expect(shoprite.getAttribute('href')).toBe('/projects/p-zzs/inspections/i-shop')
    expect(shoprite.textContent).toContain('ZZ status-guard test')
    expect(screen.getByText('verify')).toBeTruthy()
    expect(screen.getByText('in progress')).toBeTruthy()
  })

  it('on a project page, links the counts to the filtered list and does not repeat the project name', () => {
    render(<InspectionsOverviewPanel overview={overview} projectId="p-zzs" />)
    expect(screen.getByRole('link', { name: /Awaiting verification/ }).getAttribute('href')).toBe(
      '/projects/p-zzs/inspections?status=awaiting_verification',
    )
    expect(screen.getByRole('link', { name: /^Shoprite/ }).textContent).toBe('Shoprite')
  })
})
