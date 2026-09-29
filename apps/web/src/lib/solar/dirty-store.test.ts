import { describe, it, expect, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { isSolarDirty, setSolarDirty, useSolarDirtyGuard } from './dirty-store'

afterEach(() => { setSolarDirty(false) })

describe('solar dirty store', () => {
  it('holds a single unsaved-changes flag', () => {
    expect(isSolarDirty()).toBe(false)
    setSolarDirty(true)
    expect(isSolarDirty()).toBe(true)
  })

  it('the guard mirrors the form state, arms beforeunload, and clears on unmount', () => {
    const { rerender, unmount } = renderHook(({ dirty }) => useSolarDirtyGuard(dirty), { initialProps: { dirty: false } })
    expect(isSolarDirty()).toBe(false)
    rerender({ dirty: true })
    expect(isSolarDirty()).toBe(true)
    const ev = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    unmount()
    expect(isSolarDirty()).toBe(false)
  })
})
