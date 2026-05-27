'use client'

/**
 * Unsaved-changes guard for the settings shell.
 *
 * Exposes a context with:
 *   - isDirty: any registered form has unsaved changes
 *   - dirtyTab: the slug of the dirty tab (or null)
 *   - markDirty(slug) / markClean(): forms call these on input changes
 *   - promptNav(href): tabs and intra-app links call this instead of plain
 *     router.push; if dirty, shows the modal; otherwise navigates immediately.
 *
 * Also wires window 'beforeunload' so tab-close / browser-back triggers
 * the native browser confirmation while dirty.
 *
 * Phase 2 PRs wire actual forms to markDirty/markClean. PR-1c ships the
 * infrastructure only.
 */

import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'

type Slug = string

interface DirtyFormContext {
  isDirty: boolean
  dirtyTab: Slug | null
  markDirty: (slug: Slug) => void
  markClean: () => void
  promptNav: (href: string) => void
}

const Ctx = createContext<DirtyFormContext | null>(null)

export function useDirtyForm(): DirtyFormContext {
  const v = useContext(Ctx)
  if (!v) throw new Error('useDirtyForm must be used inside <UnsavedChangesGuard>')
  return v
}

export function UnsavedChangesGuard({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [dirtyTab, setDirtyTab] = useState<Slug | null>(null)
  const [pendingHref, setPendingHref] = useState<string | null>(null)

  const isDirty = dirtyTab !== null

  const markDirty = useCallback((slug: Slug) => setDirtyTab(slug), [])
  const markClean = useCallback(() => setDirtyTab(null), [])

  const promptNav = useCallback((href: string) => {
    if (isDirty) {
      setPendingHref(href)
    } else {
      router.push(href)
    }
  }, [isDirty, router])

  // Beforeunload — native browser confirmation on tab/window close while dirty.
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const stay = () => setPendingHref(null)
  const discard = () => {
    const href = pendingHref
    setPendingHref(null)
    setDirtyTab(null)
    if (href) router.push(href)
  }

  const ctxValue: DirtyFormContext = { isDirty, dirtyTab, markDirty, markClean, promptNav }

  return (
    <Ctx.Provider value={ctxValue}>
      {children}
      {pendingHref && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsaved-title"
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200,
          }}
          onClick={stay}
        >
          <div
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              borderRadius: 8,
              padding: '20px 24px',
              maxWidth: 420,
              boxShadow: '0 10px 40px rgba(0,0,0,0.45)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <h2 id="unsaved-title" style={{ margin: '0 0 8px', fontSize: 18 }}>Unsaved changes</h2>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--c-text-mid)' }}>
              You have unsaved changes on this tab. What would you like to do?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={stay} autoFocus style={{ padding: '6px 14px', fontSize: 13 }}>Stay</button>
              <button onClick={discard} style={{ padding: '6px 14px', fontSize: 13 }}>Discard</button>
            </div>
          </div>
        </div>
      )}
    </Ctx.Provider>
  )
}
