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
      onClick={confirm}
      disabled={isPending}
      className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-colors text-sm"
    >
      {isPending ? 'Confirming…' : '✓ Confirm Delivery Received'}
    </button>
  )
}
