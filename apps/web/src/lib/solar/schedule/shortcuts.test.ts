import { describe, it, expect } from 'vitest'
import { SCHEDULE_SHORTCUTS, matchShortcut } from './shortcuts'

const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, tagName = 'DIV') =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: { tagName, isContentEditable: false }, ...mods })

describe('every listed shortcut works (listed == functional)', () => {
  for (const s of SCHEDULE_SHORTCUTS) {
    it(`${s.label}`, () => {
      expect(matchShortcut(s.example, true)).toBe(s.action)
    })
  }
})

describe('matchShortcut', () => {
  it('undo, redo (both chords), on Ctrl and on ⌘', () => {
    expect(matchShortcut(k('z', { ctrlKey: true }), true)).toBe('undo')
    expect(matchShortcut(k('z', { metaKey: true }), true)).toBe('undo')
    expect(matchShortcut(k('Z', { metaKey: true, shiftKey: true }), true)).toBe('redo')
    expect(matchShortcut(k('y', { ctrlKey: true }), true)).toBe('redo')
  })
  it('zoom in with = or + whether or not Shift is down', () => {
    expect(matchShortcut(k('=', { ctrlKey: true }), true)).toBe('zoomIn')
    expect(matchShortcut(k('+', { ctrlKey: true, shiftKey: true }), true)).toBe('zoomIn')
    expect(matchShortcut(k('-', { ctrlKey: true }), true)).toBe('zoomOut')
  })
  it('Delete only ever names the arming action (the page asks before deleting)', () => {
    expect(matchShortcut(k('Delete'), true)).toBe('deleteSelected')
    expect(matchShortcut(k('Backspace'), true)).toBe('deleteSelected')
    expect(SCHEDULE_SHORTCUTS.find((s) => s.action === 'deleteSelected')!.label).toMatch(/confirm/i)
  })
  it('leaves browser find alone and ignores typing in fields', () => {
    expect(matchShortcut(k('f', { ctrlKey: true }), true)).toBeNull()
    expect(matchShortcut(k('n', {}, 'INPUT'), true)).toBeNull()
    expect(matchShortcut(k('Delete', {}, 'TEXTAREA'), true)).toBeNull()
    expect(matchShortcut(k('a', { ctrlKey: true }, 'INPUT'), true)).toBeNull()
    expect(matchShortcut(k('Escape', {}, 'INPUT'), true)).toBe('clearSelection')
  })
  it('a focused row checkbox is not a text field: Delete still arms the confirm after ticking a row', () => {
    const on = (key: string, type: string) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: { tagName: 'INPUT', type } })
    expect(matchShortcut(on('Delete', 'checkbox'), true)).toBe('deleteSelected')
    expect(matchShortcut({ ...on('a', 'checkbox'), ctrlKey: true }, true)).toBe('selectAll')
    expect(matchShortcut(on('Delete', 'text'), true)).toBeNull()
    expect(matchShortcut(on('Delete', 'date'), true)).toBeNull()
  })
  it('edit shortcuts do nothing at View level; view shortcuts still work', () => {
    expect(matchShortcut(k('n'), false)).toBeNull()
    expect(matchShortcut(k('Delete'), false)).toBeNull()
    expect(matchShortcut(k('z', { ctrlKey: true }), false)).toBeNull()
    expect(matchShortcut(k('/'), false)).toBe('focusSearch')
    expect(matchShortcut(k('?', { shiftKey: true }), false)).toBe('help')
  })
})
