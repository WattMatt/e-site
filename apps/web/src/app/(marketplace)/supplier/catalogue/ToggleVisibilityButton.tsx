'use client'

import { useState, useTransition } from 'react'
import { toggleCatalogueVisibilityAction } from '@/actions/supplier.actions'

export function ToggleVisibilityButton({ itemId, visible }: { itemId: string; visible: boolean }) {
  const [currentVisible, setCurrentVisible] = useState(visible)
  const [isPending, startTransition] = useTransition()

  function toggle() {
    startTransition(async () => {
      const result = await toggleCatalogueVisibilityAction(itemId, !currentVisible)
      if (!result.error) setCurrentVisible(v => !v)
    })
  }

  return (
    <button
      onClick={toggle}
      disabled={isPending}
      title={currentVisible ? 'Hide from marketplace' : 'Show in marketplace'}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '5px 10px',
        borderRadius: 4,
        background: currentVisible ? '#14532d' : 'var(--c-elevated)',
        color: currentVisible ? '#4ade80' : 'var(--c-text-dim)',
        border: `1px solid ${currentVisible ? '#166534' : 'var(--c-border)'}`,
        cursor: isPending ? 'not-allowed' : 'pointer',
        opacity: isPending ? 0.5 : 1,
        transition: 'all 0.15s',
      }}
    >
      {isPending ? '…' : currentVisible ? 'Visible' : 'Hidden'}
    </button>
  )
}
