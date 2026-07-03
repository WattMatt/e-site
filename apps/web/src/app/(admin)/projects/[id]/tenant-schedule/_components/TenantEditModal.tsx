'use client'

/**
 * TenantEditModal — full-form edit of a tenant entry's identity fields
 * (SHOP NO. / tenant name / GLA) from the Tenant Schedule table.
 *
 * - The DB code is shown as context but is IMMUTABLE (derived once at import;
 *   cable feeds, CoCs and reports hang off it — see tenant-entry.actions.ts).
 * - Changing SHOP NO. shows a warning: Excel re-imports match tenants by
 *   SHOP NO., so future schedule uploads must carry the new number.
 * - Blank GLA saves as null — "area pending", same as the import semantics.
 *
 * Mirrors TenantDeleteModal (createPortal + useTransition; hooks unconditional).
 */

import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { updateTenantEntryAction } from '@/actions/tenant-entry.actions'

export interface TenantEditModalNode {
  id: string
  code: string
  shop_number: string | null
  shop_name: string | null
  name: string | null
  shop_area_m2: number | null
}

export function TenantEditModal({
  projectId,
  node,
  onClose,
}: {
  projectId: string
  node: TenantEditModalNode
  onClose: () => void
}) {
  const router = useRouter()
  const originalShopNumber = (node.shop_number ?? '').trim()

  const [shopNumber, setShopNumber] = useState(node.shop_number ?? '')
  // Prefill with the value the table displays (shop_name, falling back to the
  // node name); saving materialises the fallback into shop_name, which is the
  // explicit form of the same display.
  const [shopName, setShopName] = useState(node.shop_name ?? node.name ?? '')
  const [area, setArea] = useState(node.shop_area_m2 != null ? String(node.shop_area_m2) : '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, startSave] = useTransition()

  const shopNumberChanged = shopNumber.trim() !== originalShopNumber && shopNumber.trim() !== ''

  function handleSave() {
    setError(null)

    const trimmedNumber = shopNumber.trim()
    if (!trimmedNumber) {
      setError('SHOP NO. is required.')
      return
    }

    const trimmedArea = area.trim()
    let shopAreaM2: number | null = null
    if (trimmedArea !== '') {
      const n = Number(trimmedArea)
      if (Number.isNaN(n)) {
        setError('GLA must be a number (leave it blank if the area is still pending).')
        return
      }
      shopAreaM2 = n
    }

    const trimmedName = shopName.trim()

    startSave(async () => {
      const result = await updateTenantEntryAction(projectId, node.id, {
        shopNumber: trimmedNumber,
        shopName: trimmedName === '' ? null : trimmedName,
        shopAreaM2,
      })
      if ('error' in result) {
        setError(result.error)
        return
      }
      onClose()
      router.refresh()
    })
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Edit tenant ${node.shop_number ?? node.code}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.55)', padding: 16,
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onClose() }}
    >
      <div style={{
        background: 'var(--c-surface)',
        border: '1px solid var(--c-border)',
        borderRadius: 8,
        padding: 24,
        width: '100%',
        maxWidth: 440,
        maxHeight: '90vh',
        overflowY: 'auto',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <h2 style={{ margin: '0 0 4px', fontFamily: 'var(--font-sans)', fontSize: 16, fontWeight: 600, color: 'var(--c-text)' }}>
          Edit tenant entry
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>
          DB code <span style={{ color: 'var(--c-text-mid)' }}>{node.code}</span> — does not change
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="SHOP NO." id="tenant-edit-shop-number">
            <input
              id="tenant-edit-shop-number"
              value={shopNumber}
              onChange={(e) => setShopNumber(e.target.value)}
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>

          <Field label="Tenant name" id="tenant-edit-shop-name">
            <input
              id="tenant-edit-shop-name"
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
              placeholder="Blank = unnamed / vacant"
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>

          <Field label="GLA (m²)" id="tenant-edit-area">
            <input
              id="tenant-edit-area"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              inputMode="decimal"
              placeholder="Blank = area pending"
              disabled={isSaving}
              style={inputStyle}
            />
          </Field>
        </div>

        {shopNumberChanged && (
          <p style={{
            margin: '14px 0 0',
            padding: '8px 10px',
            fontSize: 12,
            lineHeight: 1.5,
            color: 'var(--c-amber)',
            background: 'var(--c-amber-dim)',
            borderRadius: 4,
            fontFamily: 'var(--font-sans)',
          }}>
            Re-imports match tenants by SHOP NO. — future schedule uploads must use{' '}
            <strong>{shopNumber.trim()}</strong> for this tenant, or it will be flagged for
            decommissioning. The DB code {node.code} stays as is.
          </p>
        )}

        {error && (
          <p role="alert" style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--c-red)', fontFamily: 'var(--font-sans)' }}>
            {error}
          </p>
        )}

        <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSave} isLoading={isSaving} disabled={isSaving}>
            Save
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  fontSize: 13,
  fontFamily: 'var(--font-sans)',
  color: 'var(--c-text)',
  background: 'var(--c-bg)',
  border: '1px solid var(--c-border)',
  borderRadius: 5,
  outline: 'none',
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          marginBottom: 4,
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--c-text-dim)',
        }}
      >
        {label}
      </label>
      {children}
    </div>
  )
}
