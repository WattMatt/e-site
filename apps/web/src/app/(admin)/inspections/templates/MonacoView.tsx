'use client'

import dynamic from 'next/dynamic'

// Lazy-load Monaco — it's heavy and only ever runs in the browser.
const Monaco = dynamic(() => import('@monaco-editor/react'), { ssr: false })

export default function MonacoView({
  value,
  onChange,
  readOnly = false,
  height = '600px',
}: {
  value: string
  onChange?: (v: string) => void
  readOnly?: boolean
  height?: string
}) {
  return (
    <Monaco
      height={height}
      defaultLanguage="json"
      value={value}
      onChange={(v) => onChange?.(v ?? '')}
      theme="vs-dark"
      options={{
        readOnly,
        minimap: { enabled: false },
        fontSize: 12,
        scrollBeyondLastLine: false,
        wordWrap: 'on',
      }}
    />
  )
}
