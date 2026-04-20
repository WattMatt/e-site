'use client'

import { useTransition } from 'react'
import { updateOrderStatusAction } from '@/actions/supplier.actions'
import { useRouter } from 'next/navigation'

export function ConfirmDeliveryButton({ orderId }: { orderId: string }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function confirm() {
    startTransition(async () => {
      await updateOrderStatusAction(orderId, 'delivered')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={confirm}
      disabled={isPending}
      style={{
        width: '100%',
        padding: '12px 18px',
        background: '#14532d',
        border: '1px solid #166534',
        color: '#4ade80',
        borderRadius: 6,
        fontFamily: 'var(--font-sans)',
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.02em',
        cursor: isPending ? 'wait' : 'pointer',
        opacity: isPending ? 0.5 : 1,
      }}
    >
      {isPending ? 'Confirming…' : '✓ Confirm Delivery Received'}
    </button>
  )
}
