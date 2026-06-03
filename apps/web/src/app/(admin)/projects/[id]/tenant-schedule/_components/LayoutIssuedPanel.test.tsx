// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ─── Module mocks ─────────────────────────────────────────────────────────────

const { mockSetLayoutStatus } = vi.hoisted(() => ({
  mockSetLayoutStatus: vi.fn(),
}))

vi.mock('@/actions/tenant-scope.actions', () => ({
  setLayoutStatusAction: (...args: unknown[]) => mockSetLayoutStatus(...args),
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

import { LayoutIssuedPanel } from './LayoutIssuedPanel'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('LayoutIssuedPanel', () => {
  const baseProps = {
    projectId: 'proj-1',
    nodeId: 'node-1',
    shopName: 'Test Shop',
    layoutDetails: {
      node_id: 'node-1',
      layout_status: 'not_issued' as const,
      layout_issued_at: null,
    },
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders layout status display', () => {
    render(<LayoutIssuedPanel {...baseProps} />)
    expect(screen.getByText('Not Issued')).toBeDefined()
    expect(screen.getByText('Issued')).toBeDefined()
  })

  it('renders TenantDocumentList with kind="layout"', () => {
    render(<LayoutIssuedPanel {...baseProps} />)
    const list = screen.getByTestId('TenantDocumentList')
    expect(list.getAttribute('data-kind')).toBe('layout')
    expect(list.getAttribute('data-project-id')).toBe('proj-1')
    expect(list.getAttribute('data-node-id')).toBe('node-1')
    expect(list.getAttribute('data-read-only')).toBe('false')
  })

  it('renders with null layoutDetails (defaults applied)', () => {
    render(<LayoutIssuedPanel {...baseProps} layoutDetails={null} />)
    expect(screen.getByTestId('TenantDocumentList')).toBeDefined()
  })

  it('renders close button', () => {
    render(<LayoutIssuedPanel {...baseProps} />)
    expect(screen.getByLabelText('Close layout panel')).toBeDefined()
  })
})
