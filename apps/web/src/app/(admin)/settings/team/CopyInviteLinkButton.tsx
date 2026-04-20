'use client'

import { useState } from 'react'

export function CopyInviteLinkButton({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    await navigator.clipboard.writeText(`${window.location.origin}/onboarding/join?token=${token}`)
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
      }}
    >
      {copied ? '✓ Copied' : 'Copy link'}
    </button>
  )
}
