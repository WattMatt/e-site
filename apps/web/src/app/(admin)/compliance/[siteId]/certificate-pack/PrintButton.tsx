'use client'

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-primary-amber print:hidden"
      style={{ padding: '8px 16px' }}
    >
      Print / Save PDF
    </button>
  )
}
