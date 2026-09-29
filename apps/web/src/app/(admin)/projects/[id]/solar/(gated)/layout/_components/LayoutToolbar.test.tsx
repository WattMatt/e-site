import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LayoutToolbar } from './LayoutToolbar'

describe('LayoutToolbar', () => {
  it('View level shows only navigation tools', () => {
    render(<LayoutToolbar tool="select" onTool={vi.fn()} readOnly calibrated canUndo={false} canRedo={false} dirty={false} saving={false}
      circleMode={false} onCircleMode={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} onSave={vi.fn()} onAutoFill={vi.fn()} onExport={vi.fn()} on3d={vi.fn()} traceHref="/x" />)
    expect(screen.getByRole('button', { name: 'Select (V)' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Measure (M)' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Roof area (R)' })).toBeNull()
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull()
  })
  it('drawing tools are disabled with the reason on an uncalibrated sheet', () => {
    render(<LayoutToolbar tool="select" onTool={vi.fn()} readOnly={false} calibrated={false} canUndo={false} canRedo={false} dirty={false} saving={false}
      circleMode={false} onCircleMode={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} onSave={vi.fn()} onAutoFill={vi.fn()} onExport={vi.fn()} on3d={vi.fn()} traceHref="/x" />)
    const roof = screen.getByRole('button', { name: 'Roof area (R)' }) as HTMLButtonElement
    expect(roof.disabled).toBe(true)
    expect(roof.title).toBe('Calibrate this page first')
  })
  it('Save shows the dirty state and fires', () => {
    const onSave = vi.fn()
    render(<LayoutToolbar tool="select" onTool={vi.fn()} readOnly={false} calibrated canUndo canRedo={false} dirty saving={false}
      circleMode={false} onCircleMode={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} onSave={onSave} onAutoFill={vi.fn()} onExport={vi.fn()} on3d={vi.fn()} traceHref="/x" />)
    fireEvent.click(screen.getByRole('button', { name: 'Save (⌘S) •' }))
    expect(onSave).toHaveBeenCalled()
  })
})
