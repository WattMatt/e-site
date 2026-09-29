'use client'
/**
 * The `?` overlay. Rendered from the SAME table the key handler uses
 * (SCHEDULE_SHORTCUTS), so nothing is listed that does not work; edit-only
 * shortcuts are not listed below Edit, where they do nothing.
 */
import { SCHEDULE_SHORTCUTS } from '@/lib/solar/schedule/shortcuts'

export function ShortcutsOverlay({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const list = SCHEDULE_SHORTCUTS.filter((s) => canEdit || !s.editOnly)
  const groups = [...new Set(list.map((s) => s.group))]
  return (
    <div role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" style={{ position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 50 }} onClick={onClose}>
      <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', padding: 16, borderRadius: 8, width: 420, maxWidth: 'calc(100vw - 32px)', fontSize: 13 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Keyboard shortcuts</h2>
        {groups.map((g) => (
          <section key={g}>
            <h3 style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{g}</h3>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, margin: 0 }}>
              {list.filter((s) => s.group === g).map((s) => (
                <div key={s.action} style={{ display: 'contents' }}><dt>{s.label}</dt><dd style={{ margin: 0 }}><kbd>{s.keys}</kbd></dd></div>
              ))}
            </dl>
          </section>
        ))}
        <button type="button" onClick={onClose} style={{ marginTop: 12 }}>Close</button>
      </div>
    </div>
  )
}
