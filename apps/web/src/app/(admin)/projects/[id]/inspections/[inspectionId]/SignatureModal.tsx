'use client'

// Stub — real modal (react-signature-canvas) lands in Task 26.
export default function SignatureModal({
  onClose,
}: {
  inspectionId: string
  role: 'inspector' | 'verifier' | 'client' | 'witness'
  onClose: () => void
}) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: 'var(--c-panel)',
          padding: 24,
          borderRadius: 8,
          border: '1px solid var(--c-border)',
        }}
      >
        <p style={{ fontSize: 13, color: 'var(--c-text)', marginBottom: 12 }}>
          Signature capture coming in next commit.
        </p>
        <button
          onClick={onClose}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid var(--c-border)',
            borderRadius: 6,
            color: 'var(--c-text-mid)',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          Close
        </button>
      </div>
    </div>
  )
}
