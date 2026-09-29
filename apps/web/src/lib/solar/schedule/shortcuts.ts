/**
 * Schedule tab keyboard shortcuts. ONE table drives both the handler
 * (matchShortcut) and the `?` overlay (SCHEDULE_SHORTCUTS), and every row
 * carries an example event the test proves matches its action — so nothing is
 * listed that does not work (WM listed undo/redo and they did nothing).
 *
 * `Delete` only names 'deleteSelected'; the page ARMS its two-step inline
 * confirm on it and never deletes on a single key. Search is `/` so browser
 * find (Ctrl/⌘ F) is left alone. Zoom in accepts `=` and `+`, Shift or not.
 */
export type ShortcutAction =
  | 'newTask' | 'newMilestone' | 'deleteSelected' | 'undo' | 'redo' | 'selectAll' | 'clearSelection'
  | 'zoomIn' | 'zoomOut' | 'focusSearch' | 'today' | 'help'

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  target?: { tagName?: string; isContentEditable?: boolean; type?: string } | null
}

export interface ScheduleShortcut {
  action: ShortcutAction
  group: 'Tasks' | 'Edit' | 'Selection' | 'View'
  label: string
  keys: string
  /** Needs Solar Edit; below Edit the key does nothing. */
  editOnly: boolean
  example: KeyLike
  match: (e: KeyLike, mod: boolean) => boolean
}

const ev = (key: string, m: Partial<KeyLike> = {}): KeyLike =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: { tagName: 'DIV' }, ...m })
const plain = (e: KeyLike, mod: boolean) => !mod && !e.altKey

export const SCHEDULE_SHORTCUTS: ScheduleShortcut[] = [
  { action: 'newTask', group: 'Tasks', label: 'New task', keys: 'N', editOnly: true, example: ev('n'), match: (e, mod) => plain(e, mod) && e.key.toLowerCase() === 'n' },
  { action: 'newMilestone', group: 'Tasks', label: 'New milestone', keys: 'M', editOnly: true, example: ev('m'), match: (e, mod) => plain(e, mod) && e.key.toLowerCase() === 'm' },
  { action: 'deleteSelected', group: 'Tasks', label: 'Delete selected (asks you to confirm)', keys: 'Delete / Backspace', editOnly: true, example: ev('Delete'), match: (e, mod) => plain(e, mod) && (e.key === 'Delete' || e.key === 'Backspace') },
  { action: 'undo', group: 'Edit', label: 'Undo', keys: 'Ctrl/⌘ Z', editOnly: true, example: ev('z', { ctrlKey: true }), match: (e, mod) => mod && !e.shiftKey && e.key.toLowerCase() === 'z' },
  { action: 'redo', group: 'Edit', label: 'Redo', keys: 'Ctrl/⌘ Shift Z, Ctrl/⌘ Y', editOnly: true, example: ev('z', { metaKey: true, shiftKey: true }), match: (e, mod) => mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y') },
  { action: 'selectAll', group: 'Selection', label: 'Select all shown tasks', keys: 'Ctrl/⌘ A', editOnly: false, example: ev('a', { ctrlKey: true }), match: (e, mod) => mod && e.key.toLowerCase() === 'a' },
  { action: 'clearSelection', group: 'Selection', label: 'Clear selection / cancel', keys: 'Esc', editOnly: false, example: ev('Escape'), match: (e) => e.key === 'Escape' },
  { action: 'zoomIn', group: 'View', label: 'Zoom in', keys: 'Ctrl/⌘ + (or =)', editOnly: false, example: ev('=', { ctrlKey: true }), match: (e, mod) => mod && (e.key === '=' || e.key === '+') },
  { action: 'zoomOut', group: 'View', label: 'Zoom out', keys: 'Ctrl/⌘ −', editOnly: false, example: ev('-', { ctrlKey: true }), match: (e, mod) => mod && (e.key === '-' || e.key === '_') },
  { action: 'focusSearch', group: 'View', label: 'Search tasks', keys: '/', editOnly: false, example: ev('/'), match: (e, mod) => plain(e, mod) && e.key === '/' },
  { action: 'today', group: 'View', label: 'Scroll to today', keys: 'T', editOnly: false, example: ev('t'), match: (e, mod) => plain(e, mod) && e.key.toLowerCase() === 't' },
  { action: 'help', group: 'View', label: 'Show shortcuts', keys: '?', editOnly: false, example: ev('?', { shiftKey: true }), match: (e, mod) => !mod && e.key === '?' },
]

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
/** Inputs that take no typing: a focused row checkbox must not swallow Delete / Ctrl+A. */
const NOT_TYPED = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'])

function isTypingTarget(t: KeyLike['target']): boolean {
  if (!t) return false
  if (t.isContentEditable === true) return true
  const tag = String(t.tagName ?? '').toUpperCase()
  if (!TYPING.has(tag)) return false
  return !(tag === 'INPUT' && NOT_TYPED.has(String(t.type ?? '').toLowerCase()))
}

export function matchShortcut(e: KeyLike, canEdit: boolean): ShortcutAction | null {
  const typing = isTypingTarget(e.target)
  if (typing && e.key !== 'Escape') return null
  const mod = e.ctrlKey || e.metaKey
  for (const s of SCHEDULE_SHORTCUTS) {
    if (s.editOnly && !canEdit) continue
    if (s.match(e, mod)) return s.action
  }
  return null
}
