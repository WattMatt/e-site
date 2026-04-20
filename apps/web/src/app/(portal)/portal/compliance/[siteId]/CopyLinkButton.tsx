'use client'

import { useState } from 'react'

export function CopyLinkButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={copy}
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        color: copied ? '#4ade80' : 'var(--c-amber)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        letterSpacing: '0.04em',
        flexShrink: 0,
      }}
    >
      {copied ? '✓ Copied' : 'Copy link'}
    </button>
  )
}
