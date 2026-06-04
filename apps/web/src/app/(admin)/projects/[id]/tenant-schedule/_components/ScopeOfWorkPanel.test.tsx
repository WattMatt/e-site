// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const { mockSetScopeItemParty } = vi.hoisted(() => ({
  mockSetScopeItemParty: vi.fn(),
}))

vi.mock('@/actions/tenant-scope.actions', () => ({
  setScopeItemPartyAction: (...args: unknown[]) => mockSetScopeItemParty(...args),
}))

vi.mock('./TenantDocumentList', () => ({
  TenantDocumentList: (props: { kind: string; projectId: string; nodeId: string; readOnly: boolean }) => (
    <div
      data-testid="TenantDocumentList"
      data-kind={props.kind}
      data-project-id={props.projectId}
      data-node-id={props.nodeId}
      data-read-only={String(props.readOnly)}
    />
  ),
}))

import { ScopeOfWorkPanel } from './ScopeOfWorkPanel'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ScopeOfWorkPanel', () => {
  const scopeItemTypes = [
    { id: 'type-1', key: 'hvac', label: 'HVAC', sort_order: 1 },
  ]

  const baseProps = {
    projectId: 'proj-1',
    nodeId: 'node-1',
    shopName: 'Test Shop',
    scopeItemTypes,
    scopeItems: [],
    tenantDetails: {
      node_id: 'node-1',
      scope_status: 'awaited' as const,
    },
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders read-only "Awaited" status when awaited', () => {
    render(<ScopeOfWorkPanel {...baseProps} />)
    expect(screen.getByText('Awaited')).toBeDefined()
    // No toggle buttons for status — status is read-only
    expect(screen.queryByRole('button', { name: /^awaited$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^received$/i })).toBeNull()
  })

  it('renders read-only "Received" status when received', () => {
    render(
      <ScopeOfWorkPanel
        {...baseProps}
        tenantDetails={{ node_id: 'node-1', scope_status: 'received' }}
      />,
    )
    expect(screen.getByText('Received')).toBeDefined()
    expect(screen.queryByRole('button', { name: /^received$/i })).toBeNull()
  })

  it('renders TenantDocumentList with kind="scope"', () => {
    render(<ScopeOfWorkPanel {...baseProps} />)
    const list = screen.getByTestId('TenantDocumentList')
    expect(list.getAttribute('data-kind')).toBe('scope')
    expect(list.getAttribute('data-project-id')).toBe('proj-1')
    expect(list.getAttribute('data-node-id')).toBe('node-1')
    expect(list.getAttribute('data-read-only')).toBe('false')
  })

  it('renders scope items grid', () => {
    render(<ScopeOfWorkPanel {...baseProps} />)
    expect(screen.getByText('HVAC')).toBeDefined()
  })

  it('renders with null tenantDetails (defaults to awaited)', () => {
    render(<ScopeOfWorkPanel {...baseProps} tenantDetails={null} />)
    expect(screen.getByText('Awaited')).toBeDefined()
    expect(screen.getByTestId('TenantDocumentList')).toBeDefined()
  })

  it('renders close button', () => {
    render(<ScopeOfWorkPanel {...baseProps} />)
    expect(screen.getByLabelText('Close scope panel')).toBeDefined()
  })
})
