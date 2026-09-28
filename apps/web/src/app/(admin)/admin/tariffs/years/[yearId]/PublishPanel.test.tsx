import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const h = vi.hoisted(() => ({ publish: vi.fn(), validate: vi.fn(), refresh: vi.fn() }))
vi.mock('@/actions/tariff-review.actions', () => ({ publishTariffYearAction: h.publish, validateTariffYearAction: h.validate }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: h.refresh }) }))

import { PublishPanel } from './PublishPanel'

beforeEach(() => { vi.clearAllMocks(); h.publish.mockResolvedValue({ ok: true }) })

describe('PublishPanel', () => {
  it('Publish is two-step: it supersedes the previous year', async () => {
    const user = userEvent.setup()
    render(<PublishPanel yearId="y1" state="in_review" validatedAt="2026-09-28T00:00:00Z" blocking={0} unreviewedInferred={0} />)
    await user.click(screen.getByRole('button', { name: 'Publish year' }))
    expect(h.publish).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Confirm publish' }))
    expect(h.publish).toHaveBeenCalledWith({ yearId: 'y1' })
    expect(await screen.findByText('Published. The previous year is now superseded.')).toBeDefined()
  })
  it('Publish is disabled until checked with 0 blocking and every inferred unit reviewed', () => {
    render(<PublishPanel yearId="y1" state="in_review" validatedAt={null} blocking={null} unreviewedInferred={2} />)
    expect((screen.getByRole('button', { name: 'Publish year' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/2 inferred unit\(s\) still need review/)).toBeDefined()
  })
})
