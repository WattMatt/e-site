// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// ─── Module mocks ─────────────────────────────────────────────────────────────

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

  it('renders read-only "Not Issued" status when not issued', () => {
    render(<LayoutIssuedPanel {...baseProps} />)
    expect(screen.getByText('Not Issued')).toBeDefined()
    // No toggle buttons — status is read-only
    expect(screen.queryByRole('button', { name: /not issued/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^issued$/i })).toBeNull()
  })

  it('renders read-only "Issued" status with date when issued', () => {
    render(
      <LayoutIssuedPanel
        {...baseProps}
        layoutDetails={{
          node_id: 'node-1',
          layout_status: 'issued',
          layout_issued_at: '2026-06-01',
        }}
      />,
    )
    expect(screen.getByText('Issued')).toBeDefined()
    expect(screen.getByText('2026-06-01')).toBeDefined()
    // No date input
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('renders no date when layout_issued_at is null', () => {
    render(<LayoutIssuedPanel {...baseProps} />)
    // Only the status badge, no date text
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('renders TenantDocumentList with kind="layout"', () => {
    render(<LayoutIssuedPanel {...baseProps} />)
    const list = screen.getByTestId('TenantDocumentList')
    expect(list.getAttribute('data-kind')).toBe('layout')
    expect(list.getAttribute('data-project-id')).toBe('proj-1')
    expect(list.getAttribute('data-node-id')).toBe('node-1')
    expect(list.getAttribute('data-read-only')).toBe('false')
  })

  it('renders with null layoutDetails (defaults to not_issued)', () => {
    render(<LayoutIssuedPanel {...baseProps} layoutDetails={null} />)
    expect(screen.getByText('Not Issued')).toBeDefined()
    expect(screen.getByTestId('TenantDocumentList')).toBeDefined()
  })

  it('renders close button', () => {
    render(<LayoutIssuedPanel {...baseProps} />)
    expect(screen.getByLabelText('Close layout panel')).toBeDefined()
  })
})
