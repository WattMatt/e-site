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
      className={`text-xs px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${
        currentVisible
          ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-700/40 hover:bg-red-900/30 hover:text-red-400 hover:border-red-700/40'
          : 'bg-slate-700 text-slate-400 border border-slate-600 hover:bg-emerald-900/30 hover:text-emerald-400 hover:border-emerald-700/40'
      }`}
    >
      {isPending ? '…' : currentVisible ? 'Visible' : 'Hidden'}
    </button>
  )
}
