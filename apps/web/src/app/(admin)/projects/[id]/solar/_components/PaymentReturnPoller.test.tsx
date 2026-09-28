import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

const h = vi.hoisted(() => ({ push: vi.fn(), state: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push, refresh: vi.fn() }) }))
vi.mock('@/actions/solar-requests.actions', () => ({ getSolarSubscriptionStateAction: h.state }))

import { PaymentReturnPoller } from './PaymentReturnPoller'

beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('PaymentReturnPoller', () => {
  it('polls until the webhook has activated Solar, then opens the Overview', async () => {
    h.state.mockResolvedValueOnce({ active: false }).mockResolvedValueOnce({ active: true })
    render(<PaymentReturnPoller projectId="p1" />)
    expect(screen.getByRole('status').textContent).toBe('Payment received — activating Solar…')
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(h.push).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(h.push).toHaveBeenCalledWith('/projects/p1/solar/overview')
  })

  it('after 30 s says Paystack has not confirmed yet', async () => {
    h.state.mockResolvedValue({ active: false })
    render(<PaymentReturnPoller projectId="p1" />)
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    expect(screen.getByRole('status').textContent)
      .toBe('We have not received confirmation from Paystack yet. This page will update when it arrives.')
  })
})
