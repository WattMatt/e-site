'use client'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="text-sm px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors print:hidden"
    >
      Print / Save PDF
    </button>
  )
}
